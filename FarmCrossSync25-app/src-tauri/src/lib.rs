pub mod fs25;
pub mod identity;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            fs25::contract::scan_saves,
            fs25::contract::validate_save,
            fs25::contract::read_metadata,
            fs25::contract::compute_hash,
            fs25::contract::create_backup,
            fs25::contract::replace_save,
            fs25::contract::pack_save,
            fs25::contract::cleanup_pack,
            fs25::contract::open_temp_archive,
            fs25::contract::append_temp_archive,
            fs25::contract::put_archive_file,
            fs25::contract::unpack_save,
            fs25::contract::cleanup_unpack,
            fs25::contract::read_sync_state,
            fs25::contract::write_sync_state,
            fs25::contract::set_farm_slot,
            fs25::contract::list_slots,
            fs25::contract::install_save_to_slot,
            fs25::contract::detect_fs25_roots,
            fs25::contract::list_slot_bindings,
            identity::get_identity,
            identity::set_display_name,
            identity::get_backup_location,
            identity::set_backup_location,
            identity::get_fs25_root,
            identity::set_fs25_root,
            identity::store_session_token,
            identity::get_session_token,
            identity::clear_session_token,
            identity::secret_store_kind
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
