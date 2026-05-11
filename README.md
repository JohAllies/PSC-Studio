# PSC Studio Web Editor

PSC Studio Web Editor is a browser-based editor for **Pandemic Script Creator-compatible JSON scripts**.

The goal is to let users create, inspect, edit, validate, and eventually simulate PSC-style low-code scripts without needing to launch DreamBot or the original Pandemic Script Creator UI.

Dreambot is an automation application for the game Old School Runescape

PSC Studio is the product/app name.  
The underlying format is **generic JSON**, not script file specific

---

## 1. Project Goal
References
https://dreambot.org/forums/index.php?/topic/26630-pandemics-script-creator-create-your-own-private-scripts-without-programming-record-your-gameplay-chatgpt-support/

https://psc.dev/


Build a familiar, PSC-style script editor as a web application.

The editor should feel close to the original Pandemic Script Creator:

- Dense script tree
- Dark theme
- Menu-bar style navigation
- Indented action rows
- Expand/collapse blocks
- Colored comments
- Right-side properties panel
- Fast editing for large scripts
- JSON import/export
- Generic PSC-compatible format

This should not start as a visual node-canvas editor.

The main editor should behave more like a structured script/code tree than a graph builder.

---

## 2. Important Product Direction

### What this is

A generic editor for PSC JSON scripts.

It should support any valid PSC-style script, including:

- OSRS generic tasks scripts
- Tutorial scripts
- Banking scripts
- Quest scripts
- Combat scripts
- Custom action libraries
- Standalone PSC exports

### What the goal is

This is an attempt to be a web based 1:1 version of the PSC script itself. Note that PSC only runs as a Dreambot script, meaning you have to launch Dreambot and keep it open.
The problem is you need Java and an active connection and account to the Dreambot servers. Crashes may occur

All features are to be replicated including functions with the possibility to add future new functions seamlessly as the original script expands functionality or fixes

---

## 3. Mental Model

The app has three names/concepts:

```txt
PSC Studio        = product / web editor name
PSC JSON           = universal script format, bog standard JSON
Loaded Script      = current file/document being edited
Custom Actions     = reusable PSC modules / akin to methods in OOP
```

## 4. Functionality

Each line / object is drag and droppable.

- Move up and down
- Moving an object onto another creates a children branch

In the local project folder file there is a file called:
PSCFunctions.json

In this file, under each Comment segment, it will match every option available in the original software

## 5. Custom Actions

Custom actions are a dynamic way to keep the UI clean.
They can also be used as methods with the possibility of parsing parameters in
Refer to rework_KiwiB.json

Important current scope:

- In original PSC, custom actions are also saved in a separate folder when created or edited
- When saved, a copy is also written into the script file
- For PSC Studio right now, only the custom action data inside the provided script JSON matters
- The editor does not need to manage the external custom action folder yet

---

## 6. Runtime Reality

PSC is extremely lenient.

- It runs scripts top to bottom
- Errors / failed checks are often skipped instead of hard-failing
- Missing variables, weak references, or incomplete setups often do not stop execution
- Anything usually goes if PSC can continue

Example:

- If a variable comparison references a variable that does not exist, PSC may simply skip that path rather than crash the whole script

This means PSC Studio should initially favor:

- Lossless editing
- Exact ordering
- Minimal blocking validation
- Warnings over errors
- Compatibility over cleanup

The editor should not try to be stricter than PSC itself.

---

## 7. Observed JSON Structure

Based on `rework_KiwiB.json`, PSC scripts can contain more than one kind of top-level data.

Common top-level sections in that file:

- `sleep`
- `name`
- `version`
- `actions`
- `customActions`
- `images`

This means a PSC file is not just one script tree. It may also contain:

- Main/root actions
- Custom action definitions
- Embedded image assets
- Metadata used by the script

---

## 8. Core Node Shape

Most PSC content appears to use the same broad node model:

```json
{
  "id": "ACTION_ID",
  "properties": {},
  "children": [],
  "disabled": true,
  "color": -37601
}
```

Not every field is always present.

Typical notes:

- `id` identifies the action type
- `properties` is optional and highly dynamic
- `children` is optional
- `disabled` may appear on any node
- `color` is often used by comments and paint-related actions

The same general structure is used for:

- Normal script actions
- Comments
- Branching logic
- Loops
- Thread logic
- Paint/UI actions
- Custom action internals

---

## 9. Custom Action Model

`customActions` behaves like a registry/library of reusable modules.

- Definitions are stored under UUID keys
- Call sites use `CUSTOM_<uuid>`
- Parameters are passed through the calling node's `properties`
- Custom actions can set output values
- Custom actions can return false / bail out early
- In PSC itself, these may also exist as separate external files, but PSC Studio currently only needs to model the copy embedded in the loaded script JSON

This is closer to reusable script modules than a strict function system.

---

## 10. Important Compatibility Notes

### Order matters

PSC is sequential. The order of nodes is critical.

- `ELSE_BRANCH`
- `OR_BRANCH`
- `AND_BRANCH`

These are not just visual helpers. They are meaningful nodes in the sequence.

### `properties` is not a flat string map

Property values may be:

- Plain strings
- Booleans
- Numbers as strings
- Expression-like strings such as `v(Task)`, `var(Task)`, `p(WORLDTYPE)`, `lastOutput()`
- Typed objects such as filters, enums, colors, fonts, worlds, widgets
- Nested arrays such as `filters`

### Variable reference forms

For reference, variable values may be accessed as either:

- `v(thisVariable)`
- `var(thisVariable)`

Both forms should be treated as valid PSC-style variable references.

### Custom action parameter forms

Inside custom actions, defined parameters may be accessed as either:

- `p(thisParameter)`
- `param(thisParameter)`

Notes:

- These forms are for custom action parameters, not normal variables
- Custom actions do not have to define any parameters
- If a custom action has no parameters, `p()` / `param()` may not be needed at all

### `lastOutput()` vs storing loop output

In loops, storing the current iteration output into a variable is not always strictly necessary, but it is often cleaner and safer.

- `lastOutput()` can be used directly in value fields
- `SET_VARIABLE_TO_LAST_OUTPUT` stores that output explicitly into a named variable
- If other actions/checks run and also produce output, later uses of `lastOutput()` may point at the wrong thing

Because of that, using a named variable for loop state is often safer than relying on raw `lastOutput()`.

### Case and duplicate-like keys matter

In `rework_KiwiB.json`, both `SKILL` and `Skill` appear in the same object.

That means PSC Studio should preserve keys exactly and avoid aggressive normalization.

### Paint is part of the same model

Paint actions such as `PAINT_ROOT`, `DRAW_TEXT`, `DRAW_RECTANGLE_BUTTON`, and `DRAW_IMAGE` live inside the same action system, not a separate format.

### Embedded assets exist

The sample file contains an `images` object with embedded base64 assets referenced by paint actions.

---

## 11. Early Editor Rules

Until stricter behavior is proven necessary, PSC Studio should assume:

- Do not reject strange but valid-in-PSC structures
- Do not reorder nodes automatically
- Do not assume variables or references must exist
- Do not flatten or rename properties
- Do not force one "correct" script architecture
- Support incomplete scripts and partial editing states

Initial validation should be informational, not obstructive.

---

## 12. Reference Sample

`rework_KiwiB.json` is only one PSC style, but it is a useful stress test because it includes:

- Large nested action trees
- Heavy use of comments for grouping
- Variable and map-driven logic
- Threads
- Paint logic
- Custom action libraries
- Embedded image assets

It is a good reference for large-script performance and compatibility, but it should not be treated as the only valid PSC structure.
