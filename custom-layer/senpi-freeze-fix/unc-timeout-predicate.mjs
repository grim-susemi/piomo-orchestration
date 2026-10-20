// Predicate for the senpi freeze fix (plan research-session-freeze-fix, D2c).
//
// patch.mjs embeds this function verbatim into every copy of
// canonicalizeFilesystemPath, with the `export ` prefix removed. Keeping the
// text here, imported by the unit tests, is what proves the tested predicate is
// the shipped predicate.
//
// It answers: after the bounded resolver has given up, is this an ordinary UNC
// share on Windows whose synchronous fallback walker can wedge the main thread?
// ReFS device paths (`\\?\`), device names (`\\.\`) and the WSL shares keep the
// original fallback; everything else UNC is rejected with ETIMEDOUT.
export function omoFreezeFixUncTimeout(absolutePath) {
    if (process.platform !== "win32")
        return false;
    if (!absolutePath.startsWith("\\\\"))
        return false;
    const lower = absolutePath.toLowerCase();
    return !(
        lower.startsWith("\\\\?\\") ||
        lower.startsWith("\\\\.\\") ||
        lower.startsWith("\\\\wsl.localhost\\") ||
        lower.startsWith("\\\\wsl$\\")
    );
}
