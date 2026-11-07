import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import {
  ArrowClockwise,
  Calendar,
  CaretDown,
  CaretUp,
  Check,
  Clock,
  Lock,
  Monitor,
  Shield,
  Trash,
  User,
} from '@strapi/icons';
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
  PageSizeSelect,
  SortHeader,
  StatsRow,
  StyledTable,
  TablePagination,
} from './securityTabs.shared';
import {
  clampPage,
  filterSessions,
  getPageCount,
  getSelectAllState,
  getSessionStats,
  getSessionStatus,
  paginate,
  sortSessions,
  summarizeSettled,
} from './securityTabs.utils';

const STATUS_BADGE = Object.freeze({ active: 'success', expired: 'warning', revoked: 'danger' });

/**
 * JWT sessions tab: lists the sessions issued by Magic Link logins and lets
 * managers revoke, restore and clean them up. Read access lists, manage access
 * changes (plugin::magic-link.read / .manage, enforced by the server).
 */
const JWTSessions = () => {
  const { t } = useMagicLinkIntl();
  const { formatDateTime } = useFormatters();
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const {
    canRead,
    canManage,
    isLoading: isLoadingPermissions,
    error: permissionError,
  } = useMagicLinkRBAC();

  const [sessions, setSessions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');
  // { type: 'revoke'|'unrevoke'|'cleanup'|'bulkRevoke', session?: object }
  const [pendingAction, setPendingAction] = useState(null);

  const notifyError = useCallback(
    (message) =>
      toggleNotification({
        type: 'danger',
        title: t('jwt.notifications.errorTitle', 'Error'),
        message,
      }),
    [t, toggleNotification]
  );

  const notifySuccess = useCallback(
    (message) =>
      toggleNotification({
        type: 'success',
        title: t('jwt.notifications.successTitle', 'Success'),
        message,
      }),
    [t, toggleNotification]
  );

  /** Loads the sessions. Returns true on success. */
  const fetchSessions = useCallback(async () => {
    try {
      const response = await get('/magic-link/jwt-sessions');
      setSessions(Array.isArray(response?.data) ? response.data : []);
      setLoadError(false);
      return true;
    } catch {
      setLoadError(true);
      return false;
    }
  }, [get]);

  useEffect(() => {
    if (isLoadingPermissions) return undefined;
    // Without read access nothing is fetched; the loader is derived below.
    if (!canRead) return undefined;
    let active = true;
    // State is set only after the request settles (no cascading render).
    const load = async () => {
      const ok = await fetchSessions();
      if (!active) return;
      setIsLoading(false);
      if (!ok) notifyError(t('jwt.notifications.loadError', 'JWT sessions could not be loaded.'));
    };
    load();
    return () => {
      active = false;
    };
  }, [canRead, isLoadingPermissions, fetchSessions, notifyError, t]);

  const stats = useMemo(() => getSessionStats(sessions), [sessions]);

  const filteredSessions = useMemo(
    () =>
      sortSessions(
        filterSessions(sessions, { query: searchQuery, status: filterStatus }),
        sortBy,
        sortOrder
      ),
    [sessions, searchQuery, filterStatus, sortBy, sortOrder]
  );

  const pageCount = getPageCount(filteredSessions.length, pageSize);
  const safePage = clampPage(currentPage, pageCount);
  const pageSessions = useMemo(
    () => paginate(filteredSessions, safePage, pageSize),
    [filteredSessions, safePage, pageSize]
  );

  // Only sessions that are still revocable can be selected for bulk revoke.
  const selectableIds = useMemo(
    () => pageSessions.filter((s) => getSessionStatus(s) === 'active').map((s) => s.id),
    [pageSessions]
  );
  const selectedSessions = useMemo(
    () => sessions.filter((s) => selectedIds.includes(s.id) && getSessionStatus(s) === 'active'),
    [sessions, selectedIds]
  );
  const filtersActive = Boolean(searchQuery.trim()) || filterStatus !== 'all';

  const resetView = () => {
    setCurrentPage(1);
    setSelectedIds([]);
  };

  const handleSearch = (value) => {
    setSearchQuery(value);
    resetView();
  };

  const handleStatusFilter = (value) => {
    setFilterStatus(value);
    resetView();
  };

  const handlePageSize = (value) => {
    setPageSize(value);
    resetView();
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setFilterStatus('all');
    resetView();
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    const ok = await fetchSessions();
    setIsRefreshing(false);
    if (ok) {
      notifySuccess(t('jwt.notifications.refreshSuccess', 'Data has been refreshed'));
    } else {
      notifyError(t('jwt.notifications.loadError', 'JWT sessions could not be loaded.'));
    }
  };

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
    setCurrentPage(1);
  };

  /** Revokes one session after the ConfirmDialog. */
  const handleRevoke = async (session) => {
    if (!canManage) return;
    try {
      await post('/magic-link/revoke-jwt', { sessionId: session.id });
      setPendingAction(null);
      setSelectedIds((ids) => ids.filter((id) => id !== session.id));
      notifySuccess(t('jwt.notifications.revokeSuccess', 'Session revoked successfully'));
      await fetchSessions();
    } catch {
      notifyError(t('jwt.notifications.revokeError', 'Error revoking session'));
    }
  };

  /** Restores one revoked, unexpired session after the ConfirmDialog. */
  const handleUnrevoke = async (session) => {
    if (!canManage) return;
    try {
      await post('/magic-link/unrevoke-jwt', { sessionId: session.id, userId: session.userId });
      setPendingAction(null);
      notifySuccess(t('jwt.notifications.unrevokeSuccess', 'Session restored successfully'));
      await fetchSessions();
    } catch {
      notifyError(t('jwt.notifications.unrevokeError', 'Error restoring session'));
    }
  };

  /** Marks every expired session as revoked after the ConfirmDialog. */
  const handleCleanup = async () => {
    if (!canManage) return;
    try {
      const response = await post('/magic-link/cleanup-sessions');
      setPendingAction(null);
      const count = Number(response?.data?.count);
      notifySuccess(
        Number.isFinite(count)
          ? t(
              'jwt.notifications.cleanupCount',
              '{count, plural, one {# expired session cleaned up} other {# expired sessions cleaned up}}',
              { count }
            )
          : t('jwt.notifications.cleanupSuccess', 'Sessions cleaned up successfully')
      );
      await fetchSessions();
    } catch {
      notifyError(t('jwt.notifications.cleanupError', 'Error cleaning up sessions'));
    }
  };

  /** Revokes all selected active sessions; reports partial failures. */
  const handleBulkRevoke = async () => {
    if (!canManage) return;
    const ids = selectedSessions.map((s) => s.id);
    if (!ids.length) return;
    const results = await Promise.allSettled(
      ids.map((sessionId) => post('/magic-link/revoke-jwt', { sessionId }))
    );
    const summary = summarizeSettled(ids, results);
    setPendingAction(null);
    setSelectedIds(summary.failedIds);
    if (summary.failed === 0) {
      notifySuccess(
        t(
          'jwt.notifications.bulkRevokeSuccess',
          '{count, plural, one {# session revoked} other {# sessions revoked}}',
          { count: summary.succeeded }
        )
      );
    } else {
      notifyError(
        t(
          'jwt.notifications.bulkRevokePartial',
          '{succeeded} of {total} sessions revoked. The rest failed.',
          {
            succeeded: summary.succeeded,
            total: summary.total,
          }
        )
      );
    }
    await fetchSessions();
  };

  const handleSelectAll = (checked) => {
    setSelectedIds((ids) =>
      checked === true
        ? Array.from(new Set([...ids, ...selectableIds]))
        : ids.filter((id) => !selectableIds.includes(id))
    );
  };

  const handleSelect = (id, checked) => {
    setSelectedIds((ids) =>
      checked === true ? [...ids, id] : ids.filter((value) => value !== id)
    );
  };

  const confirmPending = () => {
    if (!pendingAction) return undefined;
    switch (pendingAction.type) {
      case 'revoke':
        return handleRevoke(pendingAction.session);
      case 'unrevoke':
        return handleUnrevoke(pendingAction.session);
      case 'cleanup':
        return handleCleanup();
      case 'bulkRevoke':
        return handleBulkRevoke();
      default:
        return undefined;
    }
  };

  const statusLabel = (status) =>
    ({
      active: t('jwt.status.active', 'Active'),
      expired: t('jwt.status.expired', 'Expired'),
      revoked: t('jwt.status.revoked', 'Revoked'),
    })[status];

  const sortButton = (field, label) => {
    const active = sortBy === field;
    const Icon = active && sortOrder === 'asc' ? CaretUp : CaretDown;
    return (
      <IconButton label={label} onClick={() => handleSort(field)} variant="ghost">
        <Icon aria-hidden="true" />
      </IconButton>
    );
  };

  const ariaSort = (field) => {
    if (sortBy !== field) return 'none';
    return sortOrder === 'asc' ? 'ascending' : 'descending';
  };

  const dialogCopy = () => {
    const session = pendingAction?.session;
    const who = session?.email || session?.username || t('jwt.unknownUser', 'Unknown user');
    switch (pendingAction?.type) {
      case 'revoke':
        return {
          title: t('jwt.dialog.revoke.title', 'Revoke session?'),
          description: t(
            'jwt.dialog.revoke.body',
            'The session of {user} is signed out. Its token stops working immediately.',
            { user: who }
          ),
          confirmLabel: t('jwt.actions.revoke', 'Revoke'),
          icon: <Lock aria-hidden="true" />,
          variant: 'danger',
        };
      case 'unrevoke':
        return {
          title: t('jwt.dialog.unrevoke.title', 'Restore session?'),
          description: t(
            'jwt.dialog.unrevoke.body',
            'The token of {user} works again until it expires.',
            { user: who }
          ),
          confirmLabel: t('jwt.actions.unrevoke', 'Restore'),
          icon: <Check aria-hidden="true" />,
          variant: 'default',
        };
      case 'cleanup':
        return {
          title: t('jwt.dialog.cleanup.title', 'Clean up expired sessions?'),
          description: t(
            'jwt.confirm.cleanup',
            'Mark all expired JWT sessions as revoked? Active sessions will remain unchanged.'
          ),
          confirmLabel: t('jwt.actions.cleanup', 'Clean up'),
          icon: <Trash aria-hidden="true" />,
          variant: 'danger',
        };
      case 'bulkRevoke':
        return {
          title: t('jwt.dialog.bulkRevoke.title', 'Revoke selected sessions?'),
          description: t(
            'jwt.dialog.bulkRevoke.body',
            '{count, plural, one {# session is signed out immediately.} other {# sessions are signed out immediately.}}',
            { count: selectedSessions.length }
          ),
          confirmLabel: t('jwt.actions.revokeSelected', 'Revoke selected'),
          icon: <Lock aria-hidden="true" />,
          variant: 'danger',
        };
      default:
        return { title: '', description: '', confirmLabel: '', icon: null, variant: 'danger' };
    }
  };

  const heading = <VisuallyHidden tag="h2">{t('jwt.title', 'JWT sessions')}</VisuallyHidden>;

  if (isLoadingPermissions || (canRead && isLoading)) {
    return (
      <Box>
        {heading}
        <LoadingState label={t('common.loadingSessions', 'Loading JWT sessions...')} />
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
            : t('jwt.permission.denied', 'You do not have permission to view JWT sessions.')}
        </Alert>
      </Box>
    );
  }

  const copy = dialogCopy();
  const selectAllState = getSelectAllState(selectableIds, selectedIds);

  return (
    <Box paddingBottom={7}>
      {heading}

      <StatsRow
        label={t('jwt.stats.label', 'Session statistics')}
        items={[
          {
            key: 'total',
            label: t('jwt.stats.total', 'Total'),
            value: stats.total,
            icon: Shield,
            tone: 'primary',
          },
          {
            key: 'active',
            label: t('jwt.stats.active', 'Active'),
            value: stats.active,
            icon: Check,
            tone: 'success',
          },
          {
            key: 'expired',
            label: t('jwt.stats.expired', 'Expired'),
            value: stats.expired,
            icon: Clock,
            tone: 'warning',
          },
          {
            key: 'revoked',
            label: t('jwt.stats.revoked', 'Revoked'),
            value: stats.revoked,
            icon: Lock,
            tone: 'danger',
          },
        ]}
      />

      <FilterBar role="search" aria-label={t('jwt.filters.label', 'Filter sessions')}>
        <FilterSearch>
          <Searchbar
            name="jwt-session-search"
            autoComplete="off"
            value={searchQuery}
            onChange={(event) => handleSearch(event.target.value)}
            onClear={() => handleSearch('')}
            clearLabel={t('common.search.clear', 'Clear search')}
            placeholder={t('common.searchPlaceholder', 'Search by email, username or IP...')}
          >
            {t('jwt.search.label', 'Search sessions')}
          </Searchbar>
        </FilterSearch>
        <FilterSelect>
          <SingleSelect
            aria-label={t('jwt.filters.status', 'Filter by status')}
            value={filterStatus}
            onChange={handleStatusFilter}
          >
            <SingleSelectOption value="all">
              {t('jwt.filter.all', 'All statuses')}
            </SingleSelectOption>
            <SingleSelectOption value="active">
              {t('jwt.filter.active', 'Active only')}
            </SingleSelectOption>
            <SingleSelectOption value="expired">
              {t('jwt.filter.expired', 'Expired only')}
            </SingleSelectOption>
            <SingleSelectOption value="revoked">
              {t('jwt.filter.revoked', 'Revoked only')}
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
            {t('jwt.actions.refresh', 'Refresh')}
          </Button>
          {canManage && stats.expired > 0 ? (
            <Button
              onClick={() => setPendingAction({ type: 'cleanup' })}
              startIcon={<Trash aria-hidden="true" />}
              variant="danger-light"
              size="L"
            >
              {t('jwt.actions.cleanupCount', 'Clean up ({count})', { count: stats.expired })}
            </Button>
          ) : null}
        </FilterActions>
      </FilterBar>

      {canManage && selectedSessions.length > 0 ? (
        <ActionBar>
          <Typography fontWeight="semiBold" aria-live="polite">
            {t(
              'jwt.selection.count',
              '{count, plural, one {# session selected} other {# sessions selected}}',
              {
                count: selectedSessions.length,
              }
            )}
          </Typography>
          <Flex gap={2} wrap="wrap">
            <Button onClick={() => setSelectedIds([])} variant="tertiary" size="L">
              {t('common.clearSelection', 'Clear selection')}
            </Button>
            <Button
              onClick={() => setPendingAction({ type: 'bulkRevoke' })}
              variant="danger"
              size="L"
              startIcon={<Lock aria-hidden="true" />}
            >
              {t('jwt.actions.revokeSelected', 'Revoke selected')}
            </Button>
          </Flex>
        </ActionBar>
      ) : null}

      <DataTable aria-label={t('jwt.title', 'JWT sessions')}>
        {loadError && sessions.length === 0 ? (
          <LoadErrorState
            message={t('jwt.notifications.loadError', 'JWT sessions could not be loaded.')}
            onRetry={handleRefresh}
            isRetrying={isRefreshing}
          />
        ) : filteredSessions.length === 0 ? (
          filtersActive && sessions.length > 0 ? (
            <EmptyState
              icon={Shield}
              title={t('jwt.empty.noMatches.title', 'No sessions match your filters')}
              description={t(
                'jwt.empty.noMatches.description',
                'Change the search or status filter to see more sessions.'
              )}
              actions={
                <Button onClick={handleResetFilters} variant="secondary" size="L">
                  {t('jwt.empty.resetFilters', 'Reset filters')}
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Shield}
              title={t('jwt.empty.title', 'No JWT sessions yet')}
              description={t(
                'jwt.empty.description',
                'Sessions appear here after users sign in with a magic link.'
              )}
            />
          )
        ) : (
          <>
            <StyledTable colCount={canManage ? 8 : 6} rowCount={pageSessions.length + 1}>
              <Thead>
                <Tr>
                  {canManage ? (
                    <Th>
                      <Checkbox
                        aria-label={t(
                          'jwt.table.selectAll',
                          'Select all active sessions on this page'
                        )}
                        checked={selectAllState}
                        disabled={selectableIds.length === 0}
                        onCheckedChange={handleSelectAll}
                      />
                    </Th>
                  ) : null}
                  <Th
                    aria-sort={ariaSort('username')}
                    action={sortButton(
                      'username',
                      t('common.tableHeaders.sortByUser', 'Sort by user')
                    )}
                  >
                    <SortHeader>{t('common.user', 'User')}</SortHeader>
                  </Th>
                  <Th>{t('common.tableHeaders.ipAddress', 'IP Address')}</Th>
                  <Th>{t('common.userAgent', 'User Agent')}</Th>
                  <Th
                    aria-sort={ariaSort('status')}
                    action={sortButton(
                      'status',
                      t('common.tableHeaders.sortByStatus', 'Sort by status')
                    )}
                  >
                    <SortHeader>{t('common.status', 'Status')}</SortHeader>
                  </Th>
                  <Th
                    aria-sort={ariaSort('createdAt')}
                    action={sortButton(
                      'createdAt',
                      t('common.tableHeaders.sortByCreated', 'Sort by created date')
                    )}
                  >
                    <SortHeader>{t('common.created', 'Created')}</SortHeader>
                  </Th>
                  <Th
                    aria-sort={ariaSort('expiresAt')}
                    action={sortButton(
                      'expiresAt',
                      t('common.tableHeaders.sortByExpiry', 'Sort by expiry date')
                    )}
                  >
                    <SortHeader>{t('common.expiresAt', 'Expires At')}</SortHeader>
                  </Th>
                  {canManage ? (
                    <Th>
                      <VisuallyHidden>{t('common.actions', 'Actions')}</VisuallyHidden>
                    </Th>
                  ) : null}
                </Tr>
              </Thead>
              <Tbody>
                {pageSessions.map((session) => {
                  const status = getSessionStatus(session);
                  const name =
                    session.username || session.email || t('jwt.unknownUser', 'Unknown user');
                  return (
                    <Tr key={session.id}>
                      {canManage ? (
                        <Td data-label="">
                          <Checkbox
                            aria-label={t('jwt.table.select', 'Select session of {user}', {
                              user: name,
                            })}
                            checked={selectedIds.includes(session.id)}
                            disabled={status !== 'active'}
                            onCheckedChange={(checked) => handleSelect(session.id, checked)}
                          />
                        </Td>
                      ) : null}
                      <Td data-label={t('common.user', 'User')}>
                        <Flex alignItems="center" gap={2} style={{ minWidth: 0 }}>
                          <Avatar $background={brand.primary} aria-hidden="true">
                            <User />
                          </Avatar>
                          <Flex direction="column" alignItems="flex-start" style={{ minWidth: 0 }}>
                            <Typography fontWeight="semiBold" ellipsis>
                              {name}
                            </Typography>
                            {session.username && session.email ? (
                              <Typography variant="pi" textColor="neutral600" ellipsis>
                                {session.email}
                              </Typography>
                            ) : null}
                          </Flex>
                        </Flex>
                      </Td>
                      <Td data-label={t('common.tableHeaders.ipAddress', 'IP Address')}>
                        <Typography variant="pi" textColor="neutral600">
                          {session.ipAddress || t('jwt.unknownValue', 'Unknown')}
                        </Typography>
                      </Td>
                      <Td data-label={t('common.userAgent', 'User Agent')}>
                        <Flex alignItems="center" gap={1} style={{ minWidth: 0 }}>
                          <Monitor
                            aria-hidden="true"
                            width="1.4rem"
                            height="1.4rem"
                            fill="neutral500"
                          />
                          <Typography
                            variant="pi"
                            textColor="neutral600"
                            ellipsis
                            style={{ maxWidth: '200px' }}
                            title={session.userAgent || undefined}
                          >
                            {session.userAgent || t('jwt.unknownValue', 'Unknown')}
                          </Typography>
                        </Flex>
                      </Td>
                      <Td data-label={t('common.status', 'Status')}>
                        <Badge variant={STATUS_BADGE[status]}>{statusLabel(status)}</Badge>
                      </Td>
                      <Td data-label={t('common.created', 'Created')}>
                        <Flex alignItems="center" gap={1}>
                          <Calendar
                            aria-hidden="true"
                            width="1.4rem"
                            height="1.4rem"
                            fill="neutral500"
                          />
                          <Typography variant="pi">{formatDateTime(session.createdAt)}</Typography>
                        </Flex>
                      </Td>
                      <Td data-label={t('common.expiresAt', 'Expires At')}>
                        <Flex alignItems="center" gap={1}>
                          <Clock
                            aria-hidden="true"
                            width="1.4rem"
                            height="1.4rem"
                            fill="neutral500"
                          />
                          <Typography
                            variant="pi"
                            textColor={status === 'expired' ? 'danger600' : 'neutral800'}
                            fontWeight={status === 'expired' ? 'semiBold' : undefined}
                          >
                            {formatDateTime(session.expiresAt)}
                          </Typography>
                        </Flex>
                      </Td>
                      {canManage ? (
                        <Td data-label="">
                          <Flex gap={1} justifyContent="flex-end">
                            {session.revoked ? (
                              <IconButton
                                label={
                                  session.isExpired
                                    ? t(
                                        'jwt.actions.unrevokeExpired',
                                        'Expired sessions cannot be restored'
                                      )
                                    : t('jwt.actions.unrevokeFor', 'Restore session of {user}', {
                                        user: name,
                                      })
                                }
                                variant="success-light"
                                onClick={() => setPendingAction({ type: 'unrevoke', session })}
                                disabled={Boolean(session.isExpired)}
                              >
                                <Check aria-hidden="true" />
                              </IconButton>
                            ) : (
                              <IconButton
                                label={t('jwt.actions.revokeFor', 'Revoke session of {user}', {
                                  user: name,
                                })}
                                variant="danger-light"
                                onClick={() => setPendingAction({ type: 'revoke', session })}
                              >
                                <Lock aria-hidden="true" />
                              </IconButton>
                            )}
                          </Flex>
                        </Td>
                      ) : null}
                    </Tr>
                  );
                })}
              </Tbody>
            </StyledTable>
            <TablePagination
              page={safePage}
              pageCount={pageCount}
              total={filteredSessions.length}
              pageSize={pageSize}
              onChange={(page) => {
                setCurrentPage(page);
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
        confirmIcon={copy.icon}
        variant={copy.variant}
        onConfirm={confirmPending}
        onClose={() => setPendingAction(null)}
      />
    </Box>
  );
};

export default JWTSessions;
