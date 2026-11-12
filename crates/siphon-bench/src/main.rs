use clap::{Parser, Subcommand};
use siphon_bench::measure::{Sampler, bytes_to_mb, throughput};
use siphon_bench::run_once;
use siphon_core::types::{Mode, Options};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "siphon-bench", about = "Siphon M0 feasibility harness")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Download one URL end-to-end and print stats.
    Run {
        url: String,
        #[arg(long, default_value = "./out")]
        out: PathBuf,
        #[arg(long, default_value_t = 8)]
        connections: usize,
        #[arg(long)]
        audio: bool,
    },
    /// Run the fixed sample set, measure resources, write docs/reports/m0-report.md.
    Bench {
        #[arg(long, default_value = "./out")]
        out: PathBuf,
        #[arg(long, default_value_t = 8)]
        connections: usize,
    },
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();
    match cli.cmd {
        Cmd::Run { url, out, connections, audio } => {
            let mut opts = Options::default();
            if audio { opts.mode = Mode::Audio; }
            match run_once(&url, &out, connections, &opts).await {
                Ok(s) => println!(
                    "ok service={} bytes={} elapsed_ms={} file={}",
                    s.service, s.bytes, s.elapsed_ms, s.output.display()
                ),
                Err(e) => {
                    eprintln!("error: {e}");
                    std::process::exit(1);
                }
            }
        }
        Cmd::Bench { out, connections } => {
            let samples: &[(&str, &str)] = &[
                ("youtube", "https://www.youtube.com/watch?v=jNQXAC9IVRw"),
                ("reddit", "https://www.reddit.com/r/videos/comments/6rrwyj/that_small_heart_attack/"),
            ];
            let mut report = String::from("# Siphon M0 report\n\n");
            report.push_str("| service | bytes | elapsed_ms | MB/s | peak_RAM_MB | peak_CPU% |\n");
            report.push_str("|---|---|---|---|---|---|\n");
            let opts = siphon_core::types::Options::default();
            for (name, url) in samples {
                // Run with periodic sampling:
                let mut sampler = Sampler::new();
                let run = run_once(url, &out, connections, &opts);
                tokio::pin!(run);
                let stats = loop {
                    tokio::select! {
                        r = &mut run => break r,
                        _ = tokio::time::sleep(std::time::Duration::from_millis(100)) => sampler.sample(),
                    }
                };
                match stats {
                    Ok(s) => {
                        sampler.sample();
                        report.push_str(&format!(
                            "| {} | {} | {} | {:.2} | {:.1} | {:.1} |\n",
                            name, s.bytes, s.elapsed_ms,
                            throughput(s.bytes, s.elapsed_ms) / 1_048_576.0,
                            bytes_to_mb(sampler.peak_bytes), sampler.peak_cpu
                        ));
                    }
                    Err(e) => report.push_str(&format!("| {name} | ERROR | {e} | | | |\n")),
                }
            }
            report.push_str("\nTargets (spec §9): active RAM ≤ 150 MB; throughput ≥ cobalt (target 2–5x large files).\n");
            std::fs::create_dir_all("docs/reports").ok();
            std::fs::write("docs/reports/m0-report.md", &report).unwrap();
            println!("{report}");
        }
    }
}