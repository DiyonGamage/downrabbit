use std::collections::{HashMap, HashSet};
use sysinfo::{Pid, ProcessesToUpdate, System};

pub fn bytes_to_mb(b: u64) -> f64 { b as f64 / 1_048_576.0 }

pub fn throughput(bytes: u64, elapsed_ms: u128) -> f64 {
    if elapsed_ms == 0 { return 0.0; }
    bytes as f64 / (elapsed_ms as f64 / 1000.0)
}

/// Transitive descendant closure of `root`, INCLUDING `root` itself.
/// `parent_of` maps pid -> its parent pid (entries only for processes that have a parent).
/// Fixpoint walk: repeatedly adopt any pid whose parent is already in the set.
/// Terminates because each pass either grows the set (bounded by `parent_of.len()`) or stops.
fn descendants(root: Pid, parent_of: &HashMap<Pid, Pid>) -> HashSet<Pid> {
    let mut tree: HashSet<Pid> = HashSet::new();
    tree.insert(root);
    loop {
        let before = tree.len();
        for (&pid, &parent) in parent_of {
            if tree.contains(&parent) {
                tree.insert(pid);
            }
        }
        if tree.len() == before {
            return tree;
        }
    }
}

pub struct Sampler {
    sys: System,
    pid: Pid,
    pub peak_bytes: u64,
    pub peak_cpu: f32,
}

impl Sampler {
    pub fn new() -> Self {
        let pid = Pid::from_u32(std::process::id());
        Self { sys: System::new(), pid, peak_bytes: 0, peak_cpu: 0.0 }
    }

    /// Total active-job RAM/CPU: the whole descendant process tree rooted at the bench
    /// PID (bench + yt-dlp/Python + ffmpeg + grandchildren), per spec §9.
    pub fn sample(&mut self) {
        // All-refresh discovers dynamically spawned children; remove_dead_processes=true
        // drops exited ones so a finished yt-dlp does not linger in the total.
        self.sys.refresh_processes(ProcessesToUpdate::All, true);
        let parent_of: HashMap<Pid, Pid> = self.sys.processes().iter()
            .filter_map(|(&pid, p)| p.parent().map(|par| (pid, par)))
            .collect();
        let tree = descendants(self.pid, &parent_of);
        let mut total_bytes = 0u64;
        let mut total_cpu = 0f32;
        for pid in &tree {
            if let Some(p) = self.sys.process(*pid) {
                total_bytes += p.memory();
                total_cpu += p.cpu_usage();
            }
        }
        self.peak_bytes = self.peak_bytes.max(total_bytes);
        self.peak_cpu = self.peak_cpu.max(total_cpu);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn throughput_bytes_per_sec() {
        // 1_000_000 bytes in 500 ms => 2_000_000 B/s
        let t = throughput(1_000_000, 500);
        assert!((t - 2_000_000.0).abs() < 1.0);
    }

    #[test]
    fn throughput_zero_time_is_safe() {
        assert_eq!(throughput(100, 0), 0.0);
    }

    #[test]
    fn mb_conversion() {
        assert!((bytes_to_mb(104_857_600) - 100.0).abs() < 0.001);
    }

    #[test]
    fn descendants_walks_tree_and_excludes_unrelated() {
        // root R; a->R (child), b->a (grandchild), c->U (unrelated subtree).
        let root = Pid::from_u32(100);
        let a = Pid::from_u32(101);
        let b = Pid::from_u32(102);
        let c = Pid::from_u32(103);
        let u = Pid::from_u32(200);
        let mut parent_of: HashMap<Pid, Pid> = HashMap::new();
        parent_of.insert(a, root);
        parent_of.insert(b, a);
        parent_of.insert(c, u);
        let tree = descendants(root, &parent_of);
        let expected: HashSet<Pid> = [root, a, b].into_iter().collect();
        assert_eq!(tree, expected);
    }
}