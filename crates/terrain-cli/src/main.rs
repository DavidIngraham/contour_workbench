use contour_core::{terrain, Grid, Settings};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    if args.len() != 4 {
        eprintln!("Usage: contour-cli GRID.json SETTINGS.json OUTPUT.stl\nBuild a terrain solid from a saved browser elevation grid.");
        std::process::exit(2)
    }
    let grid: Grid = serde_json::from_str(&std::fs::read_to_string(&args[1])?)?;
    let settings: Settings = serde_json::from_str(&std::fs::read_to_string(&args[2])?)?;
    let result = terrain(&grid, &settings)?;
    std::fs::write(&args[3], result.mesh.stl())?;
    println!("Validated {} triangles", result.mesh.indices.len() / 3);
    Ok(())
}
