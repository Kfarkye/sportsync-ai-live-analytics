/**
 * iOS Safari Visual Viewport Binding
 * 
 * Prevents the "widen + shift" behavior and layout jumps when the keyboard opens.
 * Syncs the visual viewport height and offset top to CSS variables:
 * --vvh: The actual visible height (excluding keyboard/browser chrome)
 * --kb: The approximated keyboard height
 */

export function bindIOSVisualViewport() {
    if (typeof window === "undefined") return;

    const vv = window.visualViewport;

    const update = () => {
        const visualH = vv?.height ?? window.innerHeight;
        document.documentElement.style.setProperty("--vvh", `${visualH}px`);

        // Keyboard height approximation: how much visual viewport shrank
        const kb = vv
            ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
            : 0;

        document.documentElement.style.setProperty("--kb", `${kb}px`);
    };

    update();

    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);

    return () => {
        vv?.removeEventListener("resize", update);
        vv?.removeEventListener("scroll", update);
        window.removeEventListener("resize", update);
    };
}
