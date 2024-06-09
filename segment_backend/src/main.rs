use segment_backend::server;

fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    server::main()?;
    Ok(())
}
