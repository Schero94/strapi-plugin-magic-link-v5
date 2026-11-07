import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Flex,
  IconButton,
  Searchbar,
  SingleSelect,
  SingleSelectOption,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import { ArrowClockwise, Check, Clock, Key, Mail, Server, Sparkle, Trash } from '@strapi/icons';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import pluginId from '../../pluginId';
import { ConfirmDialog } from '../../components/shared/ConfirmDialog';
import { useMagicLinkIntl } from '../../hooks/useMagicLinkIntl';
import { useMagicLinkRBAC } from '../../hooks/useMagicLinkRBAC';
import { useFormatters } from '../../hooks/useFormatters';
import { brand } from '../../utils/theme';
import {
  ActionBar,
  Avatar,
  DataTable,
  EmptyState,
  FilterActions,
  FilterBar,
  FilterSearch,
  FilterSelect,
  LoadErrorState,
  LoadingState,
  MonoText,
  PageSizeSelect,
  StatsRow,
  StyledTable,
  TablePagination,
} from './securityTabs.shared';
import {
  buildOtpQuery,
  clampPage,
  getOtpDeleteId,
  getOtpReference,
  getOtpStatus,
  getSelectAllState,
  normalizeOtpListResponse,
  summarizeSettled,
} from './securityTabs.utils';

const STATUS_BADGE = Object.freeze({ active: 'success', expired: 'warning', used: 'secondary' });
const SEARCH_DEBOUNCE_MS = 300;

/**
 * OTP codes tab (email only). Lists issued one-time codes with server-side
 * pagination and filters. The stored code is a hash and is never shown; rows
 * carry a short reference instead. Delete and cleanup need manage access.
 */
const OTPCodes = () => {
  const { t } = useMagicLinkIntl();
  const { formatDateTime } = useFormatters();
  const { get, del, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const {
    canRead,
    canManage,
    isLoading: isLoadingPermissions,
    error: permissionError,
  } = useMagicLinkRBAC();

  const [codes, setCodes] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10, total: 0, pageCount: 1 });
  const [stats, setStats] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedIds, setSelectedIds] = useState([]);
  // { type: 'delete'|'bulkDelete'|'cleanup', code?: object }
  const [pendingAction, setPendingAction] = useState(null);
  const requestId = useRef(0);

  const filtersActive = Boolean(search.trim()) || filterStatus !== 'all';

  const notify = useCallback(
    (type, message) =>
      toggleNotification({
        type,
        title:
          type === 'success'
            ? t('otp.notifications.successTitle', 'Success')
            : t('otp.notifications.errorTitle', 'Error'),
        message,
      }),
    [t, toggleNotification]
  );

  // Debounce the search so typing does not send one request per key.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
      setSelectedIds([]);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  /** Loads one page. Returns true on success; ignores outdated responses. */
  const fetchCodes = useCallback(async () => {
    const current = ++requestId.current;
    try {
      const { data } = await get(`/${pluginId}/otp/codes`, {
        params: buildOtpQuery({ page, pageSize, search, status: filterStatus }),
      });
      if (current !== requestId.current) return true;
      const result = normalizeOtpListResponse(data, {
        page,
        pageSize,
        status: filterStatus,
        filtersActive,
      });
      setCodes(result.codes);
      setPagination(result.pagination);
      // Keep the last complete stats while a filter hides part of the list.
      if (result.stats || !filtersActive) setStats(result.stats);
      setLoadError(false);
      if (result.pagination.page !== page) setPage(result.pagination.page);
      return true;
    } catch {
      if (current === requestId.current) setLoadError(true);
      return false;
    }
  }, [get, page, pageSize, search, filterStatus, filtersActive]);

  useEffect(() => {
    if (isLoadingPermissions) return undefined;
    // Without read access nothing is fetched; the loader is derived below.
    if (!canRead) return undefined;
    let active = true;
    // State is set only after the request settles (no cascading render).
    const load = async () => {
      const ok = await fetchCodes();
      if (!active) return;
      setIsLoading(false);
      if (!ok) notify('danger', t('otp.notifications.loadError', 'OTP codes could not be loaded.'));
    };
    load();
    return () => {
      active = false;
    };
  }, [canRead, isLoadingPermissions, fetchCodes, notify, t]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    const ok = await fetchCodes();
    setIsRefreshing(false);
    notify(
      ok ? 'success' : 'danger',
      ok
        ? t('otp.notifications.refreshSuccess', 'OTP codes refreshed')
        : t('otp.notifications.loadError', 'OTP codes could not be loaded.')
    );
  };

  const handleStatusFilter = (value) => {
    setFilterStatus(value);
    setPage(1);
    setSelectedIds([]);
  };

  const handlePageSize = (value) => {
    setPageSize(value);
    setPage(1);
    setSelectedIds([]);
  };

  const handleResetFilters = () => {
    setSearchInput('');
    setSearch('');
    setFilterStatus('all');
    setPage(1);
    setSelectedIds([]);
  };

  /** Deletes one code after the ConfirmDialog; success only when the server confirms. */
  const handleDelete = async (code) => {
    if (!canManage) return;
    const id = getOtpDeleteId(code);
    if (!id) return;
    try {
      const { data } = await del(`/${pluginId}/otp/codes/${id}`);
      if (data?.success === false) throw new Error('not deleted');
      setPendingAction(null);
      setSelectedIds((ids) => ids.filter((value) => value !== id));
      notify('success', t('otp.notifications.deleteSuccess', 'OTP code deleted'));
      await fetchCodes();
    } catch {
      notify('danger', t('otp.notifications.deleteError', 'The OTP code could not be deleted.'));
    }
  };

  /** Deletes the selected codes; reports partial failures. */
  const handleBulkDelete = async () => {
    if (!canManage) return;
    const ids = [...selectedIds];
    if (!ids.length) return;
    const results = await Promise.allSettled(ids.map((id) => del(`/${pluginId}/otp/codes/${id}`)));
    const summary = summarizeSettled(ids, results);
    setPendingAction(null);
    setSelectedIds(summary.failedIds);
    if (summary.failed === 0) {
      notify(
        'success',
        t(
          'otp.notifications.bulkDeleteSuccess',
          '{count, plural, one {# OTP code deleted} other {# OTP codes deleted}}',
          {
            count: summary.succeeded,
          }
        )
      );
    } else {
      notify(
        'danger',
        t(
          'otp.notifications.bulkDeletePartial',
          '{succeeded} of {total} OTP codes deleted. The rest failed.',
          {
            succeeded: summary.succeeded,
            total: summary.total,
          }
        )
      );
    }
    await fetchCodes();
  };

  /** Removes expired codes after the ConfirmDialog. */
  const handleCleanup = async () => {
    if (!canManage) return;
    try {
      const { data } = await post(`/${pluginId}/otp/cleanup`);
      if (data?.success === false) throw new Error('cleanup failed');
      setPendingAction(null);
      const count = Number(data?.count);
      notify(
        'success',
        Number.isFinite(count)
          ? t(
              'otp.notifications.cleanupCount',
              '{count, plural, one {# expired code removed} other {# expired codes removed}}',
              { count }
            )
          : t('otp.notifications.cleanupSuccess', 'Expired OTP codes removed')
      );
      await fetchCodes();
    } catch {
      notify(
        'danger',
        t('otp.notifications.cleanupError', 'Expired OTP codes could not be removed.')
      );
    }
  };

  const confirmPending = () => {
    switch (pendingAction?.type) {
      case 'delete':
        return handleDelete(pendingAction.code);
      case 'bulkDelete':
        return handleBulkDelete();
      case 'cleanup':
        return handleCleanup();
      default:
        return undefined;
    }
  };

  const visibleIds = useMemo(() => codes.map(getOtpDeleteId).filter(Boolean), [codes]);

  const handleSelectAll = (checked) => {
    setSelectedIds((ids) =>
      checked === true
        ? Array.from(new Set([...ids, ...visibleIds]))
        : ids.filter((id) => !visibleIds.includes(id))
    );
  };

  const handleSelect = (id, checked) => {
    setSelectedIds((ids) =>
      checked === true ? [...ids, id] : ids.filter((value) => value !== id)
    );
  };

  const statusLabel = (status) =>
    ({
      active: t('otp.status.active', 'Active'),
      expired: t('otp.status.expired', 'Expired'),
      used: t('otp.status.used', 'Used'),
    })[status];

  const typeLabel = (type) => {
    if (type === 'email') return t('otp.type.email', 'Email');
    if (type === 'totp') return t('otp.type.totp', 'Authenticator app');
    return type;
  };

  const dialogCopy = () => {
    switch (pendingAction?.type) {
      case 'delete':
        return {
          title: t('otp.dialog.delete.title', 'Delete OTP code?'),
          description: t(
            'otp.dialog.delete.body',
            'The code sent to {email} stops working immediately.',
            { email: pendingAction.code?.email || '-' }
          ),
          confirmLabel: t('common.delete', 'Delete'),
        };
      case 'bulkDelete':
        return {
          title: t('otp.dialog.bulkDelete.title', 'Delete selected OTP codes?'),
          description: t(
            'otp.dialog.bulkDelete.body',
            '{count, plural, one {# code stops working immediately.} other {# codes stop working immediately.}}',
            { count: selectedIds.length }
          ),
          confirmLabel: t('otp.actions.deleteSelected', 'Delete selected'),
        };
      case 'cleanup':
        return {
          title: t('otp.dialog.cleanup.title', 'Remove expired OTP codes?'),
          description: t(
            'otp.dialog.cleanup.body',
            'All expired codes are deleted permanently. Active codes stay valid.'
          ),
          confirmLabel: t('otp.actions.cleanup', 'Clean up'),
        };
      default:
        return { title: '', description: '', confirmLabel: '' };
    }
  };

  const heading = <VisuallyHidden tag="h2">{t('otp.title', 'OTP codes')}</VisuallyHidden>;

  if (isLoadingPermissions || (canRead && isLoading)) {
    return (
      <Box>
        {heading}
        <LoadingState label={t('otp.loading', 'Loading OTP codes...')} />
      </Box>
    );
  }

  if (permissionError || !canRead) {
    return (
      <Box>
        {heading}
        <Alert variant="danger" closeLabel={t('common.close', 'Close')}>
          {permissionError
            ? t(
                'common.permissions.loadError',
                'Your permissions could not be loaded. Reload the page to try again.'
              )
            : t('otp.permission.denied', 'You do not have permission to view OTP codes.')}
        </Alert>
      </Box>
    );
  }

  const copy = dialogCopy();
  const selectAllState = getSelectAllState(visibleIds, selectedIds);
  const expiredCount = stats?.expired ?? null;
  const showCleanup = canManage && expiredCount !== 0;

  return (
    <Box paddingBottom={7}>
      {heading}

      <StatsRow
        label={t('otp.stats.label', 'OTP code statistics')}
        items={[
          {
            key: 'total',
            label: t('otp.stats.total', 'Total'),
            value: stats?.total ?? null,
            icon: Server,
            tone: 'primary',
          },
          {
            key: 'active',
            label: t('otp.stats.active', 'Active'),
            value: stats?.active ?? null,
            icon: Sparkle,
            tone: 'success',
          },
          {
            key: 'expired',
            label: t('otp.stats.expired', 'Expired'),
            value: stats?.expired ?? null,
            icon: Clock,
            tone: 'warning',
          },
          {
            key: 'used',
            label: t('otp.stats.used', 'Used'),
            value: stats?.used ?? null,
            icon: Check,
            tone: 'secondary',
          },
        ]}
      />

      <FilterBar role="search" aria-label={t('otp.filters.label', 'Filter OTP codes')}>
        <FilterSearch>
          <Searchbar
            name="otp-search"
            autoComplete="off"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            onClear={() => setSearchInput('')}
            clearLabel={t('common.search.clear', 'Clear search')}
            placeholder={t('otp.search.placeholder', 'Search by email...')}
          >
            {t('otp.search.label', 'Search OTP codes')}
          </Searchbar>
        </FilterSearch>
        <FilterSelect>
          <SingleSelect
            aria-label={t('otp.filters.status', 'Filter by status')}
            value={filterStatus}
            onChange={handleStatusFilter}
          >
            <SingleSelectOption value="all">
              {t('otp.filter.all', 'All statuses')}
            </SingleSelectOption>
            <SingleSelectOption value="active">
              {t('otp.filter.active', 'Active only')}
            </SingleSelectOption>
            <SingleSelectOption value="expired">
              {t('otp.filter.expired', 'Expired only')}
            </SingleSelectOption>
            <SingleSelectOption value="used">
              {t('otp.filter.used', 'Used only')}
            </SingleSelectOption>
          </SingleSelect>
        </FilterSelect>
        <FilterSelect>
          <PageSizeSelect value={pageSize} onChange={handlePageSize} />
        </FilterSelect>
        <FilterActions>
          <Button
            onClick={handleRefresh}
            startIcon={<ArrowClockwise aria-hidden="true" />}
            variant="secondary"
            size="L"
            loading={isRefreshing}
          >
            {t('otp.actions.refresh', 'Refresh')}
          </Button>
          {showCleanup ? (
            <Button
              startIcon={<Trash aria-hidden="true" />}
              onClick={() => setPendingAction({ type: 'cleanup' })}
              variant="danger-light"
              size="L"
            >
              {expiredCount === null
                ? t('otp.actions.cleanup', 'Clean up')
                : t('otp.actions.cleanupCount', 'Clean up ({count})', { count: expiredCount })}
            </Button>
          ) : null}
        </FilterActions>
      </FilterBar>

      {canManage && selectedIds.length > 0 ? (
        <ActionBar>
          <Typography fontWeight="semiBold" aria-live="polite">
            {t(
              'otp.selection.count',
              '{count, plural, one {# code selected} other {# codes selected}}',
              {
                count: selectedIds.length,
              }
            )}
          </Typography>
          <Flex gap={2} wrap="wrap">
            <Button onClick={() => setSelectedIds([])} variant="tertiary" size="L">
              {t('common.clearSelection', 'Clear selection')}
            </Button>
            <Button
              onClick={() => setPendingAction({ type: 'bulkDelete' })}
              variant="danger"
              size="L"
              startIcon={<Trash aria-hidden="true" />}
            >
              {t('otp.actions.deleteSelected', 'Delete selected')}
            </Button>
          </Flex>
        </ActionBar>
      ) : null}

      <DataTable aria-label={t('otp.title', 'OTP codes')}>
        {loadError && codes.length === 0 ? (
          <LoadErrorState
            message={t('otp.notifications.loadError', 'OTP codes could not be loaded.')}
            onRetry={handleRefresh}
            isRetrying={isRefreshing}
          />
        ) : codes.length === 0 ? (
          filtersActive ? (
            <EmptyState
              icon={Key}
              title={t('otp.empty.noMatches.title', 'No OTP codes match your filters')}
              description={t(
                'otp.empty.noMatches.description',
                'Change the search or status filter to see more codes.'
              )}
              actions={
                <Button onClick={handleResetFilters} variant="secondary" size="L">
                  {t('otp.empty.resetFilters', 'Reset filters')}
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Key}
              title={t('otp.empty.title', 'No OTP codes yet')}
              description={t(
                'otp.empty.description',
                'Codes appear here as soon as a magic link login asks for an email code.'
              )}
            />
          )
        ) : (
          <>
            <StyledTable colCount={canManage ? 9 : 7} rowCount={codes.length + 1}>
              <Thead>
                <Tr>
                  {canManage ? (
                    <Th>
                      <Checkbox
                        aria-label={t('otp.table.selectAll', 'Select all codes on this page')}
                        checked={selectAllState}
                        onCheckedChange={handleSelectAll}
                      />
                    </Th>
                  ) : null}
                  <Th>{t('otp.table.reference', 'Reference')}</Th>
                  <Th>{t('otp.table.email', 'Email')}</Th>
                  <Th>{t('otp.table.type', 'Type')}</Th>
                  <Th>{t('common.status', 'Status')}</Th>
                  <Th>{t('otp.table.attempts', 'Attempts')}</Th>
                  <Th>{t('common.created', 'Created')}</Th>
                  <Th>{t('common.expiresAt', 'Expires At')}</Th>
                  {canManage ? (
                    <Th>
                      <VisuallyHidden>{t('common.actions', 'Actions')}</VisuallyHidden>
                    </Th>
                  ) : null}
                </Tr>
              </Thead>
              <Tbody>
                {codes.map((code) => {
                  const id = getOtpDeleteId(code);
                  const status = getOtpStatus(code);
                  const reference = getOtpReference(code);
                  return (
                    <Tr key={id ?? reference}>
                      {canManage ? (
                        <Td data-label="">
                          <Checkbox
                            aria-label={t(
                              'otp.table.select',
                              'Select code {reference} for {email}',
                              {
                                reference,
                                email: code.email || '-',
                              }
                            )}
                            checked={selectedIds.includes(id)}
                            disabled={!id}
                            onCheckedChange={(checked) => handleSelect(id, checked)}
                          />
                        </Td>
                      ) : null}
                      <Td data-label={t('otp.table.reference', 'Reference')}>
                        <MonoText>{reference}</MonoText>
                      </Td>
                      <Td data-label={t('otp.table.email', 'Email')}>
                        <Flex alignItems="center" gap={2} style={{ minWidth: 0 }}>
                          <Avatar $background={brand.gradient} aria-hidden="true">
                            <Mail />
                          </Avatar>
                          <Typography variant="omega" ellipsis>
                            {code.email || '-'}
                          </Typography>
                        </Flex>
                      </Td>
                      <Td data-label={t('otp.table.type', 'Type')}>
                        <Badge>{typeLabel(code.type)}</Badge>
                      </Td>
                      <Td data-label={t('common.status', 'Status')}>
                        <Badge variant={STATUS_BADGE[status]}>{statusLabel(status)}</Badge>
                      </Td>
                      <Td data-label={t('otp.table.attempts', 'Attempts')}>
                        <Typography variant="omega">{code.attempts}</Typography>
                      </Td>
                      <Td data-label={t('common.created', 'Created')}>
                        <Typography variant="pi">{formatDateTime(code.createdAt)}</Typography>
                      </Td>
                      <Td data-label={t('common.expiresAt', 'Expires At')}>
                        <Typography
                          variant="pi"
                          textColor={status === 'expired' ? 'danger600' : 'neutral800'}
                          fontWeight={status === 'expired' ? 'semiBold' : undefined}
                        >
                          {formatDateTime(code.expiresAt)}
                        </Typography>
                      </Td>
                      {canManage ? (
                        <Td data-label="">
                          <Flex gap={1} justifyContent="flex-end">
                            <IconButton
                              label={t('otp.actions.deleteFor', 'Delete code {reference}', {
                                reference,
                              })}
                              variant="danger-light"
                              onClick={() => setPendingAction({ type: 'delete', code })}
                              disabled={!id}
                            >
                              <Trash aria-hidden="true" />
                            </IconButton>
                          </Flex>
                        </Td>
                      ) : null}
                    </Tr>
                  );
                })}
              </Tbody>
            </StyledTable>
            <TablePagination
              page={clampPage(pagination.page, pagination.pageCount)}
              pageCount={pagination.pageCount}
              total={pagination.total}
              pageSize={pagination.pageSize}
              onChange={(next) => {
                setPage(next);
                setSelectedIds([]);
              }}
            />
          </>
        )}
      </DataTable>

      <ConfirmDialog
        isOpen={canManage && pendingAction !== null}
        title={copy.title}
        description={copy.description}
        confirmLabel={copy.confirmLabel}
        confirmIcon={<Trash aria-hidden="true" />}
        onConfirm={confirmPending}
        onClose={() => setPendingAction(null)}
      />
    </Box>
  );
};

export default OTPCodes;
