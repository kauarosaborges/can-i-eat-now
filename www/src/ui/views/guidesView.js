import { t } from '../../i18n/index.js';
import { GIRTH_SITES, SKINFOLD_SITES } from '../../core/bodyComposition.js';
import { siteGuide } from '../components/measureParts.js';
import { subpageHeader } from '../components/subpageHeader.js';
import { clear, h, icon, pressable } from '../dom.js';
import { segmented } from '../forms.js';

const TOOLS = ['caliper', 'tape', 'monitor'];
const STEP_COUNT = { caliper: 6, tape: 5, monitor: 5 };
const MISTAKE_COUNT = { caliper: 5, tape: 4, monitor: 5 };
const SITES = { caliper: { kind: 'skinfold', sites: SKINFOLD_SITES }, tape: { kind: 'girth', sites: GIRTH_SITES } };

function numbered(prefix, count) {
  return Array.from({ length: count }, (_, index) => t(`${prefix}.${index + 1}`));
}

export function createGuidesView({ store, goBack }) {
  const content = h('div', { class: 'guides-content' });
  const element = h('section', { class: 'view view-guides' }, subpageHeader({ title: t('guides.title'), eyebrow: t('guides.eyebrow'), backHref: '#/body', backText: t('measure.back'), backLabel: t('measure.backLabel'), goBack }), content);
  const toolHolder = h('div', { class: 'guides-tool' });
  let tool = 'caliper';
  let openSite = null;

  function siteList() {
    const config = SITES[tool];
    if (!config) return null;
    return h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card-title', text: t(`guides.${tool}.sitesTitle`) }),
      h(
        'ul',
        { class: 'site-list' },
        config.sites.map((site) => {
          const id = `site-${config.kind}-${site}`;
          const expanded = openSite === id;
          const panel = h('div', { class: 'site-panel', id: `${id}-panel`, hidden: !expanded }, siteGuide(config.kind, site, { sex: store.state.profile.sex }));
          const button = pressable(
            h(
              'button',
              {
                type: 'button',
                class: 'disclosure',
                'aria-expanded': String(expanded),
                'aria-controls': `${id}-panel`,
                onClick: () => {
                  const next = button.getAttribute('aria-expanded') !== 'true';
                  button.setAttribute('aria-expanded', String(next));
                  panel.hidden = !next;
                  openSite = next ? id : null;
                },
              },
              h('span', { class: 'disclosure-title', text: t(`measure.sites.${config.kind}.${site}.name`) }),
              h('span', { class: 'disclosure-chevron', 'aria-hidden': 'true' }, icon('chevronRight')),
            ),
          );
          return h('li', { class: 'site-item' }, button, panel);
        }),
      ),
    );
  }

  function renderTool() {
    clear(toolHolder);
    toolHolder.append(
      ...[
        h('section', { class: 'card stack' }, h('h2', { class: 'card-title', text: t(`guides.${tool}.howTitle`) }), h('p', { class: 'field-hint', text: t(`guides.${tool}.intro`) }), h('ol', { class: 'check-list is-numbered' }, numbered(`guides.${tool}.steps`, STEP_COUNT[tool]).map((text) => h('li', { text })))),
        h('section', { class: 'card stack' }, h('h2', { class: 'card-title', text: t('guides.mistakesTitle') }), h('ul', { class: 'check-list is-warning' }, numbered(`guides.${tool}.mistakes`, MISTAKE_COUNT[tool]).map((text) => h('li', { text })))),
        tool === 'caliper' ? h('section', { class: 'card stack' }, h('h2', { class: 'card-title', text: t('guides.whatTitle') }), h('ul', { class: 'check-list' }, ['jp3male', 'jp3female', 'jp7', 'muscle'].map((key) => h('li', { text: t(`guides.what.${key}`) })))) : null,
        siteList(),
        tool === 'monitor' ? h('a', { class: 'button button-primary pressable', href: '#/pressure' }, icon('heart'), t('measure.cta.pressure')) : h('a', { class: 'button button-primary pressable', href: '#/measure' }, icon('ruler'), t('measure.cta.measure')),
      ].filter(Boolean),
    );
  }

  function render() {
    clear(content);
    content.append(
      segmented({
        label: t('guides.toolLabel'),
        value: tool,
        options: TOOLS.map((value) => ({ value, label: t(`guides.${value}.name`) })),
        onChange: (value) => {
          tool = value;
          openSite = null;
          renderTool();
        },
      }),
      toolHolder,
    );
    renderTool();
  }

  return {
    element,
    mounted() {
      render();
    },
    tick() {},
    refresh() {},
    destroy() {},
  };
}
