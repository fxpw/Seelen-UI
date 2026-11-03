/// Keep asset embedding isolated from frequent edits to main.rs.
/// build.rs tracks dist so standalone builds include the current frontend.
pub fn get_context() -> tauri::Context {
    tauri::generate_context!()
}
