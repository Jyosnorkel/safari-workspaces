# Tabby branding

Generated with the built-in imagegen tool on November 1, 2026. Master: `tabby-master.png`; derived PNG sizes are used by the extension and native app.

Current revision: simplified flat blue windows, retaining the approved shapes and red/yellow/green controls. Original glass artwork is preserved as `tabby-glass-v1.png`.

Edit prompt (built-in imagegen): Preserve exactly the three rounded Mac window shapes, proportions, diagonal upper-left to lower-right stack and traffic-light positions. Replace liquid glass with uniform solid blue (#2385EB). No gradients, shine, glow, reflection, bevel, texture or shadow. Narrow transparent separation at overlaps. Flat red/yellow/green circles, no titlebar dividers. Transparent background, no text or added elements.

The branding changes preserve bundle IDs, storage keys and backup format identifiers. Build target and artifact paths retain Safari Dev Lab for compatibility with existing scripts. Real Safari icon rendering remains unverified; no Safari sessions were changed.

Validation: all 176 automated fake-browser/model checks pass; native Debug build and strict deep signature verification pass. Both built bundle display names read Tabby, and packaged extension PNG bytes match source. These checks do not establish actual Safari toolbar rendering. No browser control or model inference calls were used.
