import {
  Button,
  Checkbox,
  Dots,
  Flex,
  IconButton,
  Loader,
  NextLink,
  PageLink,
  Pagination,
  PreviousLink,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import {
  ArrowClockwise,
  Calendar,
  CaretDown,
  CaretUp,
  Check,
  Clock,
  Eye,
  Plus,
  Trash,
  User,
  WarningCircle,
} from '@strapi/icons';
import { useMagicLinkIntl } from '../../../hooks/useMagicLinkIntl';
import { useFormatters } from '../../../hooks/useFormatters';
import { accent } from '../../../utils/theme';
import {
  activateOnEnterOrSpace,
  getPaginationItems,
  getTokenActions,
  getTokenKey,
  getTokenReference,
  isPast,
} from '../tokenModel';
import { TokenStatusBadge } from './TokenStatus';
import {
  ActionSlot,
  Avatar,
  DataTable,
  GradientButton,
  MetaIcon,
  PaginationBar,
  ReferenceChip,
  StateIcon,
  StatePanel,
  StyledTable,
} from './tokenStyles';

/** Column label that is visible in the mobile card layout only. */
const CellLabel = ({ children }) => (
  <span className="cell-label" aria-hidden="true">
    {children}
  </span>
);

/**
 * @param {object} props
 * @param {'email'|'status'|'createdAt'|'expires_at'} props.field
 * @param {string} props.label
 * @param {{sortBy: string, sortOrder: 'asc'|'desc'}} props.sort
 * @param {(field: string) => void} props.onSort
 */
const SortableTh = ({ field, label, sort, onSort }) => {
  const { t } = useMagicLinkIntl();
  const active = sort.sortBy === field;
  const ascending = active && sort.sortOrder === 'asc';
  return (
    <Th
      aria-sort={active ? (ascending ? 'ascending' : 'descending') : 'none'}
      action={
        <IconButton
          label={t('tokens.table.sortByColumn', 'Sort by {column}', { column: label })}
          onClick={() => onSort(field)}
          variant="ghost"
          withTooltip={false}
        >
          {ascending ? <CaretUp aria-hidden="true" /> : <CaretDown aria-hidden="true" />}
        </IconButton>
      }
    >
      <Typography variant="sigma" textColor={active ? 'neutral800' : 'neutral600'}>
        {label}
      </Typography>
    </Th>
  );
};

/**
 * Token table with loading, error and empty states, selection, sorting and
 * pagination (with ellipses).
 */
export const TokensTable = ({
  rows,
  totalCount,
  isLoading,
  error,
  onRetry,
  hasFilters,
  onResetFilters,
  canManage,
  onCreate,
  selectedKeys,
  onToggleRow,
  onToggleAllVisible,
  sort,
  onSort,
  page,
  pageCount,
  onPageChange,
  onView,
  onExtend,
  onDelete,
}) => {
  const { t } = useMagicLinkIntl();
  const { formatDateTime } = useFormatters();

  if (isLoading && totalCount === 0) {
    return (
      <DataTable>
        <StatePanel aria-busy="true">
          <Loader>{t('tokens.loading', 'Loading tokens...')}</Loader>
        </StatePanel>
      </DataTable>
    );
  }

  if (error) {
    return (
      <DataTable>
        <StatePanel role="alert">
          <StateIcon aria-hidden="true">
            <WarningCircle focusable="false" />
          </StateIcon>
          <Typography tag="p" variant="delta" textColor="neutral800">
            {t('tokens.error.title', 'Tokens could not be loaded')}
          </Typography>
          <Typography tag="p" variant="omega" textColor="neutral600">
            {t(
              'tokens.error.description',
              'Check your connection and permissions, then try again.'
            )}
          </Typography>
          <Button variant="secondary" size="M" startIcon={<ArrowClockwise />} onClick={onRetry}>
            {t('tokens.actions.retry', 'Try again')}
          </Button>
        </StatePanel>
      </DataTable>
    );
  }

  if (rows.length === 0) {
    const noData = totalCount === 0;
    return (
      <DataTable>
        <StatePanel>
          <StateIcon aria-hidden="true">
            <Eye focusable="false" />
          </StateIcon>
          <Typography tag="p" variant="beta" textColor="neutral800">
            {noData
              ? t('tokens.empty.noData.title', 'No tokens yet')
              : t('tokens.empty.noMatch.title', 'No matching tokens')}
          </Typography>
          <Typography tag="p" variant="omega" textColor="neutral600">
            {noData
              ? t(
                  'tokens.empty.noData.description',
                  'Tokens appear here when users request a login link or an admin creates one.'
                )
              : t(
                  'tokens.empty.noMatch.description',
                  'No token matches the search or status filter.'
                )}
          </Typography>
          {noData && canManage ? (
            <GradientButton type="button" onClick={onCreate}>
              <Plus aria-hidden="true" focusable="false" />
              {t('tokens.empty.createFirst', 'Create First Token')}
            </GradientButton>
          ) : null}
          {!noData && hasFilters ? (
            <Button variant="secondary" size="M" onClick={onResetFilters}>
              {t('tokens.empty.resetFilters', 'Reset Filters')}
            </Button>
          ) : null}
        </StatePanel>
      </DataTable>
    );
  }

  const visibleKeys = rows.map(getTokenKey);
  const selectedVisible = visibleKeys.filter((key) => selectedKeys.includes(key)).length;
  const allChecked =
    selectedVisible === 0 ? false : selectedVisible === visibleKeys.length ? true : 'indeterminate';
  const columns = canManage ? 7 : 6;

  const labels = {
    email: t('tokens.table.email', 'Email'),
    reference: t('tokens.table.reference', 'Reference'),
    status: t('tokens.table.status', 'Status'),
    created: t('tokens.table.created', 'Created'),
    expiresAt: t('tokens.table.expiresAt', 'Valid until'),
    actions: t('tokens.table.actions', 'Actions'),
  };

  return (
    <DataTable aria-busy={isLoading ? 'true' : undefined}>
      <StyledTable colCount={columns} rowCount={rows.length + 1}>
        <Thead>
          <Tr>
            {canManage ? (
              <Th>
                <Checkbox
                  aria-label={t('tokens.table.selectAll', 'Select all tokens on this page')}
                  checked={allChecked}
                  onCheckedChange={(checked) => onToggleAllVisible(visibleKeys, checked === true)}
                />
              </Th>
            ) : null}
            <SortableTh field="email" label={labels.email} sort={sort} onSort={onSort} />
            <Th>
              <Typography variant="sigma" textColor="neutral600">
                {labels.reference}
              </Typography>
            </Th>
            <SortableTh field="status" label={labels.status} sort={sort} onSort={onSort} />
            <SortableTh field="createdAt" label={labels.created} sort={sort} onSort={onSort} />
            <SortableTh field="expires_at" label={labels.expiresAt} sort={sort} onSort={onSort} />
            <Th>
              <VisuallyHidden>{labels.actions}</VisuallyHidden>
            </Th>
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((token) => {
            const key = getTokenKey(token);
            const { state, canExtend } = getTokenActions(token);
            const expired = isPast(token.expires_at);
            return (
              <Tr key={key}>
                {canManage ? (
                  <Td>
                    <Checkbox
                      aria-label={t('tokens.table.select', 'Select {email}', {
                        email: token.email,
                      })}
                      checked={selectedKeys.includes(key)}
                      onCheckedChange={(checked) => onToggleRow(key, checked === true)}
                    />
                  </Td>
                ) : null}
                <Td>
                  <CellLabel>{labels.email}</CellLabel>
                  <Flex alignItems="center" gap={2} minWidth={0}>
                    <Avatar aria-hidden="true">
                      <User focusable="false" />
                    </Avatar>
                    <Typography fontWeight="semiBold" textColor="neutral800" ellipsis>
                      {token.email}
                    </Typography>
                  </Flex>
                </Td>
                <Td className="cell-reference">
                  <CellLabel>{labels.reference}</CellLabel>
                  <Flex direction="column" alignItems="flex-start" gap={1}>
                    <ReferenceChip>#{getTokenReference(token)}</ReferenceChip>
                    {token.is_used && token.used_at ? (
                      <Flex alignItems="center" gap={1}>
                        <MetaIcon $accent={accent.success} aria-hidden="true">
                          <Check focusable="false" />
                        </MetaIcon>
                        <Typography variant="pi" textColor="neutral600">
                          {t('tokens.table.usedOn', 'Used {date}', {
                            date: formatDateTime(token.used_at),
                          })}
                        </Typography>
                      </Flex>
                    ) : null}
                    {token.ip_address ? (
                      <Typography
                        variant="pi"
                        textColor="neutral600"
                        style={{ fontFamily: 'monospace' }}
                      >
                        {t('tokens.table.ip', 'IP: {ip}', { ip: token.ip_address })}
                      </Typography>
                    ) : null}
                  </Flex>
                </Td>
                <Td>
                  <CellLabel>{labels.status}</CellLabel>
                  <TokenStatusBadge state={state} />
                </Td>
                <Td>
                  <CellLabel>{labels.created}</CellLabel>
                  <Flex alignItems="center" gap={1}>
                    <MetaIcon aria-hidden="true">
                      <Calendar focusable="false" />
                    </MetaIcon>
                    <Typography variant="pi" textColor="neutral800">
                      {formatDateTime(token.createdAt)}
                    </Typography>
                  </Flex>
                </Td>
                <Td>
                  <CellLabel>{labels.expiresAt}</CellLabel>
                  <Flex alignItems="center" gap={1}>
                    <MetaIcon $accent={expired ? accent.danger : accent.warning} aria-hidden="true">
                      <Clock focusable="false" />
                    </MetaIcon>
                    {token.expires_at ? (
                      <Typography
                        variant="pi"
                        textColor={expired ? 'danger600' : 'neutral800'}
                        fontWeight={expired ? 'semiBold' : undefined}
                      >
                        {expired
                          ? t('tokens.table.expiredOn', '{date} (expired)', {
                              date: formatDateTime(token.expires_at),
                            })
                          : formatDateTime(token.expires_at)}
                      </Typography>
                    ) : (
                      <Typography variant="pi" textColor="success600">
                        {t('tokens.details.never', 'Never')}
                      </Typography>
                    )}
                  </Flex>
                </Td>
                <Td>
                  <Flex gap={1} justifyContent="flex-end" width="100%">
                    <IconButton
                      label={t('tokens.actions.viewDetailsFor', 'View details for {email}', {
                        email: token.email,
                      })}
                      variant="ghost"
                      data-token-view={key}
                      onClick={() => onView(token)}
                      onKeyDown={activateOnEnterOrSpace(() => onView(token))}
                    >
                      <Eye aria-hidden="true" />
                    </IconButton>
                    {canManage && canExtend ? (
                      <IconButton
                        label={t('tokens.actions.extendFor', 'Extend token for {email}', {
                          email: token.email,
                        })}
                        variant="ghost"
                        onClick={() => onExtend(token)}
                        onKeyDown={activateOnEnterOrSpace(() => onExtend(token))}
                      >
                        <Clock aria-hidden="true" />
                      </IconButton>
                    ) : null}
                    {canManage && !canExtend ? <ActionSlot aria-hidden="true" /> : null}
                    {canManage ? (
                      <IconButton
                        label={t('tokens.actions.deleteFor', 'Delete token for {email}', {
                          email: token.email,
                        })}
                        variant="danger-light"
                        onClick={() => onDelete(token)}
                        onKeyDown={activateOnEnterOrSpace(() => onDelete(token))}
                      >
                        <Trash aria-hidden="true" />
                      </IconButton>
                    ) : null}
                  </Flex>
                </Td>
              </Tr>
            );
          })}
        </Tbody>
      </StyledTable>

      {pageCount > 1 ? (
        <PaginationBar>
          <Flex justifyContent="center">
            <Pagination
              activePage={page}
              pageCount={pageCount}
              label={t('tokens.pagination.label', 'Token pages')}
            >
              <PreviousLink tag="button" type="button" onClick={() => onPageChange(page - 1)}>
                {t('tokens.pagination.previous', 'Previous page')}
              </PreviousLink>
              {getPaginationItems(page, pageCount).map((item, index) =>
                item === 'dots' ? (
                  <Dots key={`dots-${index}`}>{t('tokens.pagination.more', 'More pages')}</Dots>
                ) : (
                  <PageLink
                    key={item}
                    tag="button"
                    type="button"
                    number={item}
                    onClick={() => onPageChange(item)}
                  >
                    {t('tokens.pagination.page', 'Go to page {page}', { page: item })}
                  </PageLink>
                )
              )}
              <NextLink tag="button" type="button" onClick={() => onPageChange(page + 1)}>
                {t('tokens.pagination.next', 'Next page')}
              </NextLink>
            </Pagination>
          </Flex>
          <Typography className="pagination-status" variant="pi" textColor="neutral600">
            {t('tokens.pagination.status', 'Page {page} of {count}', { page, count: pageCount })}
          </Typography>
        </PaginationBar>
      ) : null}
    </DataTable>
  );
};

export default TokensTable;
