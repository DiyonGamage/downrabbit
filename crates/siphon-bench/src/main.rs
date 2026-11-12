use clap::{Parser, Subcommand};
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
    }
}