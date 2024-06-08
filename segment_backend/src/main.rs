use segment_backend::backend;

fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    backend::main()?;
    Ok(())
}
