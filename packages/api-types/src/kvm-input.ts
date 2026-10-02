// GLKVM/PiKVM HID web key identifiers; physical positions are interpreted by the target OS layout.
export const KVM_KEY_CODES = ["KeyA", "KeyB", "KeyC", "KeyD", "KeyE", "KeyF", "KeyG", "KeyH", "KeyI", "KeyJ", "KeyK", "KeyL", "KeyM", "KeyN", "KeyO", "KeyP", "KeyQ", "KeyR", "KeyS", "KeyT", "KeyU", "KeyV", "KeyW", "KeyX", "KeyY", "KeyZ", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0", "Enter", "Escape", "Backspace", "Tab", "Space", "Minus", "Equal", "BracketLeft", "BracketRight", "Backslash", "Semicolon", "Quote", "Backquote", "Comma", "Period", "Slash", "CapsLock", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12", "PrintScreen", "Insert", "Home", "PageUp", "Delete", "End", "PageDown", "ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "ControlLeft", "ShiftLeft", "AltLeft", "MetaLeft", "ControlRight", "ShiftRight", "AltRight", "MetaRight", "Pause", "ScrollLock", "NumLock", "ContextMenu", "NumpadDivide", "NumpadMultiply", "NumpadSubtract", "NumpadAdd", "NumpadEnter", "Numpad1", "Numpad2", "Numpad3", "Numpad4", "Numpad5", "Numpad6", "Numpad7", "Numpad8", "Numpad9", "Numpad0", "NumpadDecimal", "IntlBackslash", "IntlYen", "IntlRo", "KanaMode", "Convert", "NonConvert"] as const;
export type KvmHidEvent =
  | { kind: "key"; code: string; down: boolean }
  | { kind: "move"; x: number; y: number }
  | { kind: "button"; button: "left" | "right" | "middle" | "up" | "down"; down: boolean }
  | { kind: "wheel"; x: number; y: number };
export type KvmAtomicInput = { kind: "keys"; keys: string[] } | { kind: "text"; text: string } | { kind: "click"; x: number; y: number; button: "left" | "right" | "middle" } | { kind: "scroll"; delta: number };
export type KvmConsoleInput = KvmAtomicInput | { kind: "events"; events: KvmHidEvent[] } | { kind: "release" } | { kind: "layout-text"; text: string; keymap: string };
export interface KvmKeymaps { available: string[]; default: string }
