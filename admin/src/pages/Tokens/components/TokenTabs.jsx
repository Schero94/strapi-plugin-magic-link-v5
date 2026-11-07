import { useRef } from 'react';
import { TabButton, TabList, TabsWrapper } from './tokenStyles';

/**
 * Accessible tab list (WAI-ARIA tabs pattern): role tablist/tab, aria-selected,
 * aria-controls, roving tabindex, arrow keys, Home and End. Keeps the
 * existing pill look with the gradient active tab.
 *
 * @param {object} props
 * @param {{id: string, icon: import('react').ComponentType, label: string, shortLabel: string}[]} props.tabs
 * @param {string} props.activeTab
 * @param {(id: string) => void} props.onChange
 * @param {string} props.label - accessible name of the tab list
 */
export const TokenTabs = ({ tabs, activeTab, onChange, label }) => {
  const refs = useRef({});

  const focusTab = (index) => {
    const tab = tabs[(index + tabs.length) % tabs.length];
    onChange(tab.id);
    refs.current[tab.id]?.focus();
  };

  const handleKeyDown = (event, index) => {
    const keys = {
      ArrowRight: index + 1,
      ArrowDown: index + 1,
      ArrowLeft: index - 1,
      ArrowUp: index - 1,
      Home: 0,
      End: tabs.length - 1,
    };
    if (!(event.key in keys)) return;
    event.preventDefault();
    focusTab(keys[event.key]);
  };

  return (
    <TabsWrapper>
      <TabList role="tablist" aria-label={label}>
        {tabs.map(({ id, icon: Icon, label: tabLabel, shortLabel }, index) => {
          const selected = id === activeTab;
          return (
            <TabButton
              key={id}
              ref={(node) => {
                refs.current[id] = node;
              }}
              type="button"
              role="tab"
              id={`magic-link-tab-${id}`}
              aria-selected={selected}
              aria-controls={`magic-link-panel-${id}`}
              tabIndex={selected ? 0 : -1}
              $active={selected}
              onClick={() => onChange(id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              aria-label={tabLabel}
              title={tabLabel}
            >
              <Icon aria-hidden="true" focusable="false" />
              <span className="tab-label-full">{tabLabel}</span>
              <span className="tab-label-short" aria-hidden="true">
                {shortLabel}
              </span>
            </TabButton>
          );
        })}
      </TabList>
    </TabsWrapper>
  );
};

export default TokenTabs;
