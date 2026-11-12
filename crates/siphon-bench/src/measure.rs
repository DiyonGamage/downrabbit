use sysinfo::{Pid, ProcessesToUpdate, System};

pub fn bytes_to_mb(b: u64) -> f64 { b as f64 / 1_048_576.0 }

pub fn throughput(bytes: u64, elapsed_ms: u128) -> f64 {
    if elapsed_ms == 0 { return 0.0; }
    bytes as f64 / (elapsed_ms as f64 / 1000.0)
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

    pub fn sample(&mut self) {
        self.sys.refresh_processes(ProcessesToUpdate::Some(&[self.pid]), true);
        if let Some(p) = self.sys.process(self.pid) {
            self.peak_bytes = self.peak_bytes.max(p.memory());
            self.peak_cpu = self.peak_cpu.max(p.cpu_usage());
        }
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
}