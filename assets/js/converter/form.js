import { FORM_DEFAULTS, TEXT_INPUT_TYPES } from "../config/constants.js";
import { resolveElementStyling } from "./element-styles.js";
import { newId } from "./ids.js";

/**
 * Builds native Webflow form subtrees.
 *
 * Without this, a <form> falls through to a Custom Element and the whole thing arrives in the
 * Designer as opaque markup: no Form settings, no submit handling, no success/error states.
 * Every shape here is modelled on a real "Default form" copied out of the Designer.
 *
 * Structure produced:
 *   FormWrapper
 *     FormForm            <- the actual <form>, fields live here
 *     FormSuccessMessage  <- synthesized; Webflow forms always carry both states
 *     FormErrorMessage
 */

/** Webflow derives ids/names from a display name by hyphenating the spaces. */
const toWebflowName = (value) => String(value).trim().replace(/\s+/g, "-");

/**
 * Turn a machine identifier into the human label Webflow shows in the Form settings panel.
 *
 *   first_name -> First Name    FirstName -> First Name    firstName  -> First Name
 *   URLInput   -> URL Input     address1  -> Address 1     user.email -> User Email
 *   FULL_NAME  -> Full Name     dob       -> Dob           ID         -> ID
 *
 * Acronyms are the fiddly part. A capitalised run is kept as-is when the identifier is mixed
 * case (`URLInput` -> "URL Input"), because there the capitals are clearly deliberate. When the
 * whole identifier is uppercase there is no such signal, so SCREAMING_SNAKE_CASE gets title
 * cased - except for very short words, where "ID" and "URL" are far more likely than "Id"/"Url".
 */
const ACRONYM_MAX_LENGTH = 3;

export const humanizeFieldName = (raw) => {
	const source = String(raw ?? "");
	// No lowercase letter anywhere means the casing carries no information.
	const isAllCaps = !/[a-z]/.test(source);

	const words = source
		.replace(/[_\-.]+/g, " ") // snake_case, kebab-case, dot.case
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2") // camelCase boundary
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2") // acronym then word: URLInput -> URL Input
		.replace(/([a-zA-Z])(\d)/g, "$1 $2") // address1 -> address 1
		.replace(/(\d)([a-zA-Z])/g, "$1 $2")
		.trim()
		.split(/\s+/)
		.filter(Boolean);

	const keepAsIs = (word) => word.length > 1 && /^[A-Z0-9]+$/.test(word) && (!isAllCaps || word.length <= ACRONYM_MAX_LENGTH);

	return words
		.map((word) => {
			if (keepAsIs(word)) return word;
			// Only flatten the tail when the source was all-caps; in mixed-case identifiers an
			// inner capital may well be deliberate, so leave it alone.
			const tail = isAllCaps ? word.slice(1).toLowerCase() : word.slice(1);
			return word.charAt(0).toUpperCase() + tail;
		})
		.join(" ");
};

/** Common data keys every form node carries. */
const commonData = (attr = {}, { excludeFromSearch = false } = {}) => ({
	devlink: { runtimeProps: {}, slot: "" },
	displayName: "",
	attr: { id: "", ...attr },
	xattr: [],
	search: { exclude: excludeFromSearch },
	visibility: { conditions: [], keepInHtml: { tag: "False", val: {} } },
});

/** First non-empty candidate, trimmed. */
const firstOf = (...candidates) => {
	for (const c of candidates) {
		const v = (c ?? "").toString().trim();
		if (v) return v;
	}
	return "";
};

export const createFormBuilder = ({ nodes, styles, consumed, traverseChild }) => {
	/**
	 * Attach classes/inline styles, the passthrough class, and any author attributes the field
	 * builder did not already consume (aria-*, data-*, role, ...).
	 *
	 * Anything already present in the node's own `attr` map is skipped - that is the value
	 * Webflow renders from, and repeating it in xattr would emit the attribute twice.
	 */
	const applyStyling = (node, element) => {
		const { classIds, otherClasses } = resolveElementStyling(element, styles);
		node.classes = classIds;
		if (otherClasses) node.data.xattr.push({ name: "class", value: otherClasses });

		const claimed = new Set(Object.keys(node.data.attr ?? {}).map((k) => k.toLowerCase()));
		claimed.add("class"); // handled by the style engine above
		claimed.add("style");
		Array.from(element.attributes).forEach((attr) => {
			if (!claimed.has(attr.name.toLowerCase())) {
				node.data.xattr.push({ name: attr.name, value: attr.value });
			}
		});

		return node;
	};

	const push = (node, element) => {
		if (element) applyStyling(node, element);
		nodes.push(node);
		return node._id;
	};

	// ---------------------------------------------------------------- labels

	/** The control a <label> is attached to, whether by nesting or by `for`. */
	const labelTarget = (label) => {
		const nested = label.querySelector("input, textarea, select");
		if (nested) return nested;
		const forId = label.getAttribute("for");
		if (!forId) return null;
		const doc = label.ownerDocument;
		return doc.getElementById(forId) || doc.querySelector(`[id="${CSS.escape(forId)}"]`);
	};

	/**
	 * Find the <label> that belongs to a control.
	 *
	 * `allowAdjacent` covers the bare `<input type="checkbox"><label>Text</label>` shape, which
	 * has no `for` to go on. It is deliberately OFF for text/textarea/select: without a `for`,
	 * an adjacent label is just as likely to belong to the NEXT control, and a loose match there
	 * silently mislabels the field.
	 */
	const findLabelFor = (control, scope, { allowAdjacent = false } = {}) => {
		const ancestor = control.closest("label");
		if (ancestor) return ancestor;

		const id = control.getAttribute("id");
		if (id) {
			const byFor = scope.querySelector(`label[for="${CSS.escape(id)}"]`);
			if (byFor) return byFor;
		}

		if (!allowAdjacent) return null;

		const next = control.nextElementSibling;
		// A label that wraps its own control belongs to that control, not to this one.
		const isFree = (el) => el && el.tagName === "LABEL" && !el.getAttribute("for") && !el.querySelector("input, textarea, select");
		return isFree(next) ? next : null;
	};

	/** Text of a label with any nested control's own text ignored. */
	const labelText = (label) => {
		if (!label) return "";
		const clone = label.cloneNode(true);
		clone.querySelectorAll("input, textarea, select").forEach((n) => n.remove());
		return clone.textContent.replace(/\s+/g, " ").trim();
	};

	// ------------------------------------------------------- field naming

	/**
	 * Webflow needs three related values per field: a human `data-name` for the Form settings
	 * panel, plus the `name`/`id` pair that actually goes on the tag.
	 *
	 * The display name comes from the `name` attribute first, humanized - `first_name` and
	 * `FirstName` both become "First Name" - because that is the one value a form is guaranteed
	 * to have and it is what identifies the field in submissions. Label and placeholder are the
	 * fallbacks. An explicit `data-name` still wins outright, since the author wrote the exact
	 * value we would otherwise be guessing at.
	 *
	 * `name`/`id` keep the author's raw values so existing handlers and `for`/`id` label
	 * associations keep working; only the human-facing label is rewritten.
	 */
	const fieldNaming = (control, label, fallback) => {
		const display = firstOf(
			control.getAttribute("data-name"),
			humanizeFieldName(control.getAttribute("name")),
			labelText(label),
			control.getAttribute("placeholder"),
			humanizeFieldName(control.getAttribute("id")),
			control.getAttribute("aria-label"),
			fallback,
		);
		const name = firstOf(control.getAttribute("name"), toWebflowName(display));
		const id = firstOf(control.getAttribute("id"), name);
		return { display, name, id };
	};

	const boolAttr = (element, attr) => element.hasAttribute(attr);

	// ------------------------------------------------------------ controls

	const buildTextInput = (input, scope) => {
		const type = (input.getAttribute("type") || "text").toLowerCase();
		const label = findLabelFor(input, scope);
		const { display, name, id } = fieldNaming(input, label, "Field");
		const maxLength = Number(input.getAttribute("maxlength")) || FORM_DEFAULTS.inputMaxLength;

		return push(
			{
				_id: newId(),
				type: "FormTextInput",
				tag: "input",
				classes: [],
				children: [],
				data: {
					form: { name: display, type: "input", passwordPage: false },
					...commonData({
						id,
						name,
						maxlength: maxLength,
						"data-name": display,
						placeholder: input.getAttribute("placeholder") || "",
						disabled: boolAttr(input, "disabled"),
						type,
						required: boolAttr(input, "required"),
						autofocus: boolAttr(input, "autofocus"),
					}),
				},
			},
			input,
		);
	};

	const buildTextarea = (textarea, scope) => {
		const label = findLabelFor(textarea, scope);
		const { display, name, id } = fieldNaming(textarea, label, "Textarea");
		const maxLength = Number(textarea.getAttribute("maxlength")) || FORM_DEFAULTS.textareaMaxLength;

		return push(
			{
				_id: newId(),
				type: "FormTextarea",
				tag: "textarea",
				classes: [],
				children: [],
				data: {
					form: { name: display, type: "textarea" },
					...commonData({
						id,
						name,
						maxlength: maxLength,
						"data-name": display,
						placeholder: textarea.getAttribute("placeholder") || "",
						required: boolAttr(textarea, "required"),
						autofocus: boolAttr(textarea, "autofocus"),
					}),
				},
			},
			textarea,
		);
	};

	const buildSelect = (select, scope) => {
		const label = findLabelFor(select, scope);
		const { display, name, id } = fieldNaming(select, label, "Select");
		const opts = Array.from(select.options ?? []).map((opt) => ({
			t: opt.textContent.replace(/\s+/g, " ").trim(),
			v: opt.getAttribute("value") ?? "",
		}));

		return push(
			{
				_id: newId(),
				type: "FormSelect",
				tag: "select",
				classes: [],
				children: [],
				data: {
					form: { name: display, opts: opts.length ? opts : FORM_DEFAULTS.selectOptions, type: "select" },
					...commonData({
						id,
						name,
						"data-name": display,
						required: boolAttr(select, "required"),
						multiple: boolAttr(select, "multiple"),
					}),
				},
			},
			select,
		);
	};

	/**
	 * Checkbox and radio are the awkward ones: Webflow wants a wrapper div holding the input and
	 * an inline label, whereas HTML has three common shapes (label wrapping input, label after
	 * input, label before input via `for`). All three funnel through here, and both the input and
	 * its label are marked consumed so the walk doesn't emit them twice.
	 */
	const buildToggle = (input, scope, kind) => {
		const label = findLabelFor(input, scope, { allowAdjacent: true });
		consumed.add(input);
		if (label) consumed.add(label);

		const isRadio = kind === "radio";
		const { display, name, id } = fieldNaming(input, label, isRadio ? "Radio" : "Checkbox");
		const text = labelText(label) || display;

		const inputAttr = {
			type: kind,
			name,
			id,
			"data-name": display,
			required: boolAttr(input, "required"),
		};
		if (isRadio) inputAttr.value = firstOf(input.getAttribute("value"), text, display);
		else inputAttr.checked = boolAttr(input, "checked");

		const inputId = push(
			{
				_id: newId(),
				type: isRadio ? "FormRadioInput" : "FormCheckboxInput",
				tag: "input",
				classes: [],
				children: [],
				data: {
					form: { type: isRadio ? "radio-input" : "checkbox-input", name: display },
					inputType: "default",
					...commonData(inputAttr),
				},
			},
			input,
		);

		const textId = newId();
		nodes.push({ _id: textId, text: true, v: text });

		const labelNode = {
			_id: newId(),
			type: "FormInlineLabel",
			tag: "label",
			classes: [],
			children: [textId],
			data: {
				form: { type: isRadio ? "radio-label" : "checkbox-label" },
				...commonData(),
			},
		};
		const labelId = push(labelNode, label || undefined);

		return push({
			_id: newId(),
			type: isRadio ? "FormRadioWrapper" : "FormCheckboxWrapper",
			tag: "div",
			classes: [],
			children: [inputId, labelId],
			data: {
				form: { type: kind },
				...commonData(),
			},
		});
	};

	const buildButton = (element) => {
		const isInput = element.tagName === "INPUT";
		const value = firstOf(
			isInput ? element.getAttribute("value") : element.textContent,
			FORM_DEFAULTS.submitLabel,
		);

		return push(
			{
				_id: newId(),
				type: "FormButton",
				tag: "input",
				classes: [],
				children: [],
				data: {
					form: { type: "button" },
					eventIds: [],
					...commonData({
						type: "submit",
						value,
						"data-wait": element.getAttribute("data-wait") || FORM_DEFAULTS.waitLabel,
					}),
				},
			},
			element,
		);
	};

	const buildBlockLabel = (label) => {
		const children = [];
		Array.from(label.childNodes).forEach((child) => {
			const childId = traverseChild(child);
			if (childId) children.push(childId);
		});

		return push(
			{
				_id: newId(),
				type: "FormBlockLabel",
				tag: "label",
				classes: [],
				children,
				data: {
					form: { type: "label", passwordPage: false },
					...commonData({ for: label.getAttribute("for") || "" }),
				},
			},
			label,
		);
	};

	// ------------------------------------------------- success / error states

	/** Webflow's message blocks are a state div wrapping a text Block. */
	const buildMessage = (kind, text) => {
		const textId = newId();
		nodes.push({ _id: textId, text: true, v: text });

		const innerId = push({
			_id: newId(),
			type: "Block",
			tag: "div",
			classes: [],
			children: [textId],
			data: {
				tag: "div",
				text: true,
				...commonData(),
			},
		});

		return push({
			_id: newId(),
			type: kind === "success" ? "FormSuccessMessage" : "FormErrorMessage",
			tag: "div",
			classes: [],
			children: [innerId],
			data: {
				form: { type: kind === "success" ? "msg-done" : "msg-fail" },
				...commonData(),
			},
		});
	};

	// ------------------------------------------------------------- entry points

	/**
	 * Convert a control encountered inside a <form>.
	 * @returns {string|null|undefined} node id, null to skip (already consumed), or undefined
	 *   when this element is not a form control and should follow the generic path.
	 */
	const tryBuildControl = (element, scope) => {
		if (consumed.has(element)) return null;

		const tag = element.tagName;

		if (tag === "LABEL") {
			const target = labelTarget(element);
			const targetType = target?.tagName === "INPUT" ? (target.getAttribute("type") || "text").toLowerCase() : null;
			// A label attached to a checkbox/radio is part of that control's wrapper, not a
			// standalone block label - build the whole wrapper from here.
			if (targetType === "checkbox" || targetType === "radio") {
				if (consumed.has(target)) return null;
				return buildToggle(target, scope, targetType);
			}
			return buildBlockLabel(element);
		}

		if (tag === "TEXTAREA") return buildTextarea(element, scope);
		if (tag === "SELECT") return buildSelect(element, scope);

		if (tag === "BUTTON") {
			const type = (element.getAttribute("type") || "submit").toLowerCase();
			return type === "submit" ? buildButton(element) : undefined;
		}

		if (tag === "INPUT") {
			const type = (element.getAttribute("type") || "text").toLowerCase();
			if (type === "checkbox" || type === "radio") return buildToggle(element, scope, type);
			if (type === "submit" || type === "button") return buildButton(element);
			if (TEXT_INPUT_TYPES.includes(type)) return buildTextInput(element, scope);
			// file, date, range, color, hidden, ... have no native Webflow equivalent - let them
			// fall through to a Custom Element rather than inventing a broken mapping.
			return undefined;
		}

		return undefined;
	};

	/** Convert a whole <form> element into a FormWrapper subtree. @returns {string} wrapper id */
	const buildForm = (formEl) => {
		const display = firstOf(
			formEl.getAttribute("data-name"),
			formEl.getAttribute("name"),
			formEl.getAttribute("id"),
			formEl.getAttribute("aria-label"),
			FORM_DEFAULTS.formName,
		);
		const slug = toWebflowName(display);

		const children = [];
		Array.from(formEl.childNodes).forEach((child) => {
			const childId = traverseChild(child);
			if (childId) children.push(childId);
		});

		const formId = push(
			{
				_id: newId(),
				type: "FormForm",
				tag: "form",
				classes: [],
				children,
				data: {
					Source: { tag: "Default form", val: {} },
					form: { type: "form", name: display },
					...commonData({
						id: `wf-form-${slug}`,
						name: `wf-form-${slug}`,
						"data-name": display,
						redirect: "",
						"data-redirect": "",
						action: formEl.getAttribute("action") || "",
						method: (formEl.getAttribute("method") || "get").toLowerCase(),
					}),
				},
			},
			formEl,
		);

		const successId = buildMessage("success", FORM_DEFAULTS.successText);
		const errorId = buildMessage("error", FORM_DEFAULTS.errorText);

		// The wrapper is excluded from site search, matching Webflow's own default form.
		return push({
			_id: newId(),
			type: "FormWrapper",
			tag: "div",
			classes: [],
			children: [formId, successId, errorId],
			data: {
				form: { type: "wrapper" },
				...commonData({}, { excludeFromSearch: true }),
			},
		});
	};

	return { buildForm, tryBuildControl };
};
