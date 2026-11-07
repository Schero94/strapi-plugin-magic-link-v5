import { Box, Searchbar, SingleSelect, SingleSelectOption } from '@strapi/design-system';
import { useMagicLinkIntl } from '../../../hooks/useMagicLinkIntl';
import { PAGE_SIZES, STATUS_FILTERS } from '../tokenModel';
import { getStatusLabel } from './TokenStatus';
import { FilterBar } from './tokenStyles';

/**
 * Search, status filter and page size. All controls are size S (32px) so the
 * row has one height; the bar wraps below 768px with the search on its own row.
 *
 * @param {object} props
 * @param {string} props.search
 * @param {(value: string) => void} props.onSearchChange
 * @param {string} props.status
 * @param {(value: string) => void} props.onStatusChange
 * @param {number} props.pageSize
 * @param {(value: number) => void} props.onPageSizeChange
 */
export const TokensFilterBar = ({
  search,
  onSearchChange,
  status,
  onStatusChange,
  pageSize,
  onPageSizeChange,
}) => {
  const { t } = useMagicLinkIntl();

  return (
    <FilterBar role="search">
      <Box className="filter-search">
        <Searchbar
          name="token-search"
          autoComplete="off"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          onClear={() => onSearchChange('')}
          clearLabel={t('common.search.clear', 'Clear search')}
          placeholder={t('tokens.search.placeholder', 'Search by email, reference or IP...')}
        >
          {t('tokens.search.label', 'Search tokens')}
        </Searchbar>
      </Box>
      <Box className="filter-select">
        <SingleSelect
          size="S"
          aria-label={t('tokens.filter.status', 'Filter by status')}
          value={status}
          onChange={(value) => onStatusChange(String(value))}
        >
          {STATUS_FILTERS.map((value) => (
            <SingleSelectOption key={value} value={value}>
              {value === 'all' ? t('tokens.filter.all', 'All statuses') : getStatusLabel(t, value)}
            </SingleSelectOption>
          ))}
        </SingleSelect>
      </Box>
      <Box className="filter-select">
        <SingleSelect
          size="S"
          aria-label={t('common.entriesPerPage', 'Entries per page')}
          value={String(pageSize)}
          onChange={(value) => onPageSizeChange(Number(value))}
        >
          {PAGE_SIZES.map((size) => (
            <SingleSelectOption key={size} value={String(size)}>
              {t('tokens.pageSize.option', '{count} per page', { count: size })}
            </SingleSelectOption>
          ))}
        </SingleSelect>
      </Box>
    </FilterBar>
  );
};

export default TokensFilterBar;
