# @alvaroak/pi-centered-slash-menu

Centered overlay menus for the [Pi coding agent](https://github.com/earendil-works/pi). Extension-only — no core modifications.

Two behaviors:

1. **Slash autocomplete** — keeps Pi's native slash autocomplete behavior, but renders the list as a centered passive overlay above the editor instead of inline below it. Typing, filtering, enter/tab completion, escape, and argument handling remain Pi's own implementation.
2. **Built-in selectors** — `/model`, `/thinking`, `/settings`, etc. normally replace the editor inline via `showSelector()`. This patch shows those selector components as centered capturing overlays.

## Install

```bash
pi install git:github.com/Alvaroak/pi-centered-slash-menu@v0.1.0
```

## Usage

Toggle with `/pi-floating-menu`.

## License

MIT
