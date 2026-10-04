(function (wp) {
  'use strict';
  const el = wp.element.createElement;
  const { useState, useEffect, Fragment } = wp.element;
  const { InspectorControls, useBlockProps } = wp.blockEditor;
  const { PanelBody, SelectControl, RangeControl, ToggleControl, Placeholder, Spinner, Notice, Button } = wp.components;
  wp.blocks.registerBlockType('zoer/content-module', {
    apiVersion: 3,
    title: 'Content Module',
    category: 'embed',
    icon: 'welcome-learn-more',
    description: 'Display a reusable HTML course or interactive module from your module library.',
    keywords: ['course', 'learning', 'interactive', 'storyline'],
    attributes: { moduleId: { type: 'number', default: 0 }, height: { type: 'number', default: 650 }, showTitle: { type: 'boolean', default: true }, showOpenLink: { type: 'boolean', default: true } },
    supports: { html: false, align: ['wide', 'full'] },
    edit: function ({ attributes, setAttributes }) {
      const [modules, setModules] = useState(null);
      const [error, setError] = useState('');
      const [revision, setRevision] = useState(0);
      const blockProps = useBlockProps({ className: 'zcm-editor' });
      useEffect(function () {
        let current = true;
        setError('');
        wp.apiFetch({ path: '/zoer-content-modules/v1/modules' }).then(function (items) {
          if (current) setModules(items);
        }).catch(function () {
          if (current) setError('Could not load the module library. Check your connection and try again.');
        });
        return function () { current = false; };
      }, [revision]);
      const selected = modules && modules.find(function (item) { return item.id === attributes.moduleId; });
      const choices = [{ label: 'Choose a module…', value: 0 }].concat((modules || []).map(function (item) { return { label: item.title, value: item.id }; }));
      if (attributes.moduleId && modules && !selected) choices.push({ label: 'Unavailable module #' + attributes.moduleId, value: attributes.moduleId });
      const picker = el(SelectControl, { label: 'Module', value: attributes.moduleId, options: choices, onChange: function (value) { setAttributes({ moduleId: Number(value) }); }, __nextHasNoMarginBottom: true, __next40pxDefaultSize: true });
      return el(Fragment, null,
        el(InspectorControls, null, el(PanelBody, { title: 'Module settings', initialOpen: true },
          picker,
          el(RangeControl, { label: 'Player height (pixels)', value: attributes.height, min: 320, max: 1200, step: 10, onChange: function (height) { setAttributes({ height }); }, __nextHasNoMarginBottom: true, __next40pxDefaultSize: true }),
          el(ToggleControl, { label: 'Show module title', checked: attributes.showTitle, onChange: function (showTitle) { setAttributes({ showTitle }); }, __nextHasNoMarginBottom: true }),
          el(ToggleControl, { label: 'Show link to open in a new tab', checked: attributes.showOpenLink, onChange: function (showOpenLink) { setAttributes({ showOpenLink }); }, __nextHasNoMarginBottom: true })
        )),
        el('div', blockProps, el(Placeholder, { icon: 'welcome-learn-more', label: 'Content Module', instructions: 'Choose a module from the library. The interactive player appears on the published page.' },
          error ? el(Notice, { status: 'error', isDismissible: false }, error) : !modules ? el(Spinner) : null,
          modules ? picker : null,
          modules && !modules.length ? el('p', null, 'Your library is empty. Ask an administrator to import a package under Content Modules in WordPress.') : null,
          modules && attributes.moduleId && !selected ? el(Notice, { status: 'warning', isDismissible: false }, 'This module is archived or missing. Choose an available module.') : null,
          selected ? el('p', null, el('strong', null, selected.title), ' · Player height: ' + attributes.height + 'px') : null,
          selected ? el(Button, { variant: 'secondary', href: selected.url, target: '_blank', rel: 'noopener' }, 'Preview module') : null,
          el(Button, { variant: 'tertiary', onClick: function () { setRevision(revision + 1); } }, 'Refresh library')
        ))
      );
    },
    save: function () { return null; }
  });
})(window.wp);
