/**
 * Centered Slash Menu
 *
 * Two behaviors, both extension-only (no core modifications):
 *
 * 1. Slash autocomplete: keeps Pi's native slash autocomplete behavior, but moves
 *    the rendered autocomplete list from below the editor to a centered passive
 *    overlay. Typing, filtering, enter/tab completion, escape, and argument
 *    handling remain Pi's own implementation.
 *
 * 2. Built-in selectors (/model, /thinking, /settings, etc.): Pi's showSelector()
 *    replaces the editor inline with the selector component. We patch
 *    InteractiveMode.prototype.showSelector to show those selector components as
 *    centered capturing overlays instead.
 *
 * Toggle both with /pi-floating-menu.
 */

import { CustomEditor, InteractiveMode, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component, type OverlayHandle } from "@earendil-works/pi-tui";

class LinesOverlay implements Component {
	constructor(
		private lines: string[],
		private readonly border: (text: string) => string,
	) {}

	setLines(lines: string[]): void {
		this.lines = lines;
		this.invalidate();
	}

	render(width: number): string[] {
		const innerWidth = Math.max(1, width - 4);
		const top = this.border(`┌${"─".repeat(width - 2)}┐`);
		const bottom = this.border(`└${"─".repeat(width - 2)}┘`);
		const blank = this.wrap("", innerWidth);

		return [top, blank, ...this.lines.map((line) => this.wrap(line, innerWidth)), blank, bottom];
	}

	invalidate(): void {}

	private wrap(line: string, innerWidth: number): string {
		const content = truncateToWidth(line, innerWidth, "");
		const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(content)));
		return `${this.border("│")} ${content}${padding} ${this.border("│")}`;
	}
}

/**
 * Renders a child component inside a bordered box with one blank padded row
 * above/below the content and horizontal padding. Acts as the overlay component
 * (overlay focus + mouse hit-testing target) while delegating everything to the
 * wrapped child selector component.
 */
class BorderedOverlay implements Component {
	constructor(
		private readonly child: Component & { focused?: boolean; render: (width: number) => string[] },
		private readonly border: (text: string) => string,
	) {}

	get focused(): boolean {
		return this.child.focused ?? false;
	}

	set focused(value: boolean) {
		try {
			this.child.focused = value;
		} catch {
			/* child not focusable */
		}
	}

	get wantsKeyRelease(): boolean {
		return (this.child as any).wantsKeyRelease === true;
	}

	handleInput(data: string): void {
		this.child.handleInput?.(data);
	}

	invalidate(): void {
		this.child.invalidate?.();
	}

	handleMouse(event: any): any {
		return (this.child as any).handleMouse?.({
			...event,
			x: event.x - 2,
			y: event.y - 2,
			width: event.width - 4,
			height: event.height - 4,
		});
	}

	render(width: number): string[] {
		const innerWidth = Math.max(1, width - 4);
		const top = this.border(`┌${"─".repeat(width - 2)}┐`);
		const bottom = this.border(`└${"─".repeat(width - 2)}┘`);
		const blank = this.wrap("", innerWidth);

		const childLines = this.child.render(innerWidth);
		return [top, blank, ...childLines.map((line) => this.wrap(line, innerWidth)), blank, bottom];
	}

	private wrap(line: string, innerWidth: number): string {
		const content = truncateToWidth(line, innerWidth, "");
		const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(content)));
		return `${this.border("│")} ${content}${padding} ${this.border("│")}`;
	}
}

class CenteredSlashEditor extends CustomEditor {
	private autocompleteOverlay: LinesOverlay | null = null;
	private autocompleteOverlayHandle: OverlayHandle | null = null;

	constructor(
		tui: ConstructorParameters<typeof CustomEditor>[0],
		theme: ConstructorParameters<typeof CustomEditor>[1],
		keybindings: ConstructorParameters<typeof CustomEditor>[2],
		private readonly isEnabled: () => boolean,
	) {
		super(tui, theme, keybindings);
	}

	override handleInput(data: string): void {
		super.handleInput(data);

		if (!this.isShowingAutocomplete()) {
			this.hideAutocompleteOverlay();
		}
	}

	override render(width: number): string[] {
		const lines = super.render(width);

		if (!this.isEnabled()) {
			this.hideAutocompleteOverlay();
			return lines;
		}

		const autocompleteHeight = Number((this as any).renderedAutocompleteHeight ?? 0);

		if (autocompleteHeight <= 0 || !this.isShowingAutocomplete()) {
			this.hideAutocompleteOverlay();
			return lines;
		}

		const autocompleteLines = lines.splice(-autocompleteHeight);
		this.showAutocompleteOverlay(autocompleteLines);
		return lines;
	}

	override invalidate(): void {
		super.invalidate();
		this.autocompleteOverlay?.invalidate();
	}

	dispose(): void {
		this.hideAutocompleteOverlay();
	}

	private showAutocompleteOverlay(lines: string[]): void {
		const maxLineWidth = Math.max(40, ...lines.map((line) => visibleWidth(line)));
		const width = Math.min(104, maxLineWidth + 4);

		if (!this.autocompleteOverlay) {
			this.autocompleteOverlay = new LinesOverlay(lines, this.borderColor);
			this.autocompleteOverlayHandle = (this as any).tui.showOverlay(this.autocompleteOverlay, {
				anchor: "center",
				width,
				maxHeight: "70%",
				margin: 2,
				nonCapturing: true,
			});
			return;
		}

		this.autocompleteOverlay.setLines(lines);
	}

	private hideAutocompleteOverlay(): void {
		this.autocompleteOverlayHandle?.hide();
		this.autocompleteOverlayHandle = null;
		this.autocompleteOverlay = null;
	}
}

/**
 * Replace the built-in showSelector flow (selector swaps into the editor slot,
 * full-width at the bottom) with a centered capturing overlay. The editor stays
 * in place; done() hides the overlay and refocuses the editor.
 */
/** Captured from the editor theme at session_start; selectors reuse the same border styling. */
let borderColorFn: (text: string) => string = (text) => text;

function patchShowSelector(isEnabled: () => boolean): void {
	const proto = InteractiveMode.prototype as any;
	if (proto.__centeredShowSelector) return;

	const orig = proto.showSelector;
	proto.__centeredShowSelector = true;
	proto.showSelector = function (this: any, create: (done: () => void) => { component: Component; focus?: Component; dispose?: () => void }) {
		if (!isEnabled()) {
			return orig.call(this, create);
		}

		const ui = this.ui;
		this.disposeActiveSelector();
		this.ui.requestRender();

		const token = {};
		let handle: OverlayHandle | undefined;
		let closed = false;

		const created = create(() => {
			if (closed) return;
			closed = true;
			handle?.hide();
			if (this.activeSelectorToken === token) {
				this.activeSelectorToken = undefined;
				this.activeSelectorDispose = undefined;
			}
			ui.setFocus(this.editor);
			ui.requestRender();
		});

		const hideOverlay = () => {
			closed = true;
			handle?.hide();
			created.dispose?.();
		};

		const width = created.component.width;
		const border = borderColorFn;
		const boxed = new BorderedOverlay(created.component as any, border);
		handle = ui.showOverlay(boxed, {
			anchor: "center",
			maxHeight: "70%",
			margin: 2,
			...(width ? { width: width + 4 } : {}),
		});
		ui.setFocus(boxed);

		this.activeSelectorToken = token;
		this.activeSelectorDispose = hideOverlay;
	};
}

export default function (pi: ExtensionAPI) {
	let enabled = true;

	patchShowSelector(() => enabled);

	pi.registerCommand("pi-floating-menu", {
		description: "Toggle centered slash autocomplete overlay",
		handler: async (_args, ctx) => {
			enabled = !enabled;
			ctx.ui.notify(`Floating slash menu ${enabled ? "enabled" : "disabled"}`, "info");
		},
	});

	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			borderColorFn = theme.borderColor;
			return new CenteredSlashEditor(tui, theme, keybindings, () => enabled);
		});
	});
}
