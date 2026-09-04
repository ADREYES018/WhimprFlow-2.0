fn main() {
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rustc-link-search=/Library/Developer/CommandLineTools/usr/lib/swift/macosx");
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    }
}
