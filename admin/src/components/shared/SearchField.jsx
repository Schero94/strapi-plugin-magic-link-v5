import { forwardRef } from 'react';
import styled from 'styled-components';
import { Search, Cross } from '@strapi/icons';
import { accent, color, fontSize, theme } from '../../utils/theme';
import { reducedMotion } from './motion';
import { useMagicLinkIntl } from '../../hooks/useMagicLinkIntl';

const Wrapper = styled.div`
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
  min-width: 0;
`;

const SearchIcon = styled(Search)`
  position: absolute;
  left: 12px;
  width: 16px;
  height: 16px;
  pointer-events: none;

  path {
    fill: ${color('neutral600')};
  }
`;

const Input = styled.input`
  width: 100%;
  height: ${theme.controlHeight.L};
  padding: 0 40px;
  border: 1px solid ${color('neutral200')};
  border-radius: ${theme.borderRadius.md};
  font-size: ${fontSize(2)};
  background: ${color('neutral0')};
  color: ${color('neutral800')};
  transition:
    border-color ${theme.transitions.fast},
    box-shadow ${theme.transitions.fast};

  &:hover {
    border-color: ${color('neutral300')};
  }

  &:focus {
    outline: none;
    border-color: ${accent.primary};
    box-shadow: 0 0 0 2px rgba(2, 132, 199, 0.25);
  }

  &:focus-visible {
    outline: 2px solid ${accent.primary};
    outline-offset: 1px;
  }

  &::placeholder {
    color: ${color('neutral500')};
  }

  &::-webkit-search-cancel-button {
    display: none;
  }

  @media (max-width: 767px) {
    height: 48px;
    padding-right: 44px;
  }

  ${reducedMotion}
`;

const ClearButton = styled.button`
  position: absolute;
  right: 8px;
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: ${theme.borderRadius.sm};
  background: transparent;
  cursor: pointer;

  svg {
    width: 12px;
    height: 12px;
  }

  svg path {
    fill: ${color('neutral600')};
  }

  &:hover {
    background: ${color('neutral150')};
  }

  &:focus-visible {
    outline: 2px solid ${accent.primary};
    outline-offset: 1px;
  }

  @media (max-width: 767px) {
    right: 8px;
    width: 32px;
    height: 32px;
  }
`;

/**
 * Accessible search input with the Magic Link filter-bar look (search icon
 * left, 8px radius, neutral border, brand focus ring, 40px tall like DS
 * size L controls). It has a clear button and clears on Escape.
 *
 *   <SearchField
 *     label={t('tokens.search.label', 'Search tokens')}
 *     placeholder={t('tokens.search.placeholder', 'Search by email or IP...')}
 *     value={search}
 *     onChange={setSearch}
 *   />
 *
 * @param {object} props
 * @param {string} props.label - accessible name (required; placeholders are not labels)
 * @param {string} props.value
 * @param {(value: string) => void} props.onChange - receives the string value
 * @param {string} [props.placeholder]
 * @param {string} [props.clearLabel]
 */
export const SearchField = forwardRef(
  ({ label, value, onChange, placeholder, clearLabel, ...rest }, ref) => {
    const { t } = useMagicLinkIntl();
    const hasValue = typeof value === 'string' && value.length > 0;

    return (
      <Wrapper role="search">
        <SearchIcon aria-hidden="true" focusable="false" />
        <Input
          ref={ref}
          type="search"
          aria-label={label}
          value={value ?? ''}
          placeholder={placeholder}
          onChange={(event) => onChange?.(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && hasValue) {
              event.stopPropagation();
              onChange?.('');
            }
          }}
          autoComplete="off"
          spellCheck={false}
          {...rest}
        />
        {hasValue ? (
          <ClearButton
            type="button"
            aria-label={clearLabel ?? t('common.search.clear', 'Clear search')}
            onClick={() => onChange?.('')}
          >
            <Cross aria-hidden="true" focusable="false" />
          </ClearButton>
        ) : null}
      </Wrapper>
    );
  }
);

SearchField.displayName = 'SearchField';

export default SearchField;
