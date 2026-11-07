import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Field,
  Flex,
  IconButton,
  Modal,
  Searchbar,
  Tbody,
  Td,
  Th,
  Thead,
  TextInput,
  Tr,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import { ArrowClockwise, Check, Earth, Lock, Plus, Server, WarningCircle } from '@strapi/icons';
import styled from 'styled-components';
import { ConfirmDialog } from '../../components/shared/ConfirmDialog';
import { UnsavedChangesDialog } from '../../components/shared/UnsavedChangesDialog';
import { useMagicLinkIntl } from '../../hooks/useMagicLinkIntl';
import { useMagicLinkRBAC } from '../../hooks/useMagicLinkRBAC';
import { useDiscardGuard } from '../../hooks/useUnsavedChangesGuard';
import { brand, color, space, theme, tint } from '../../utils/theme';
import { normalizeIpAddress } from '../../utils/ipAddress.mjs';
import {
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
import { clampPage, filterIps, getIpStats, getPageCount, paginate } from './securityTabs.utils';

const WarningBox = styled.div`
  display: flex;
  align-items: flex-start;
  gap: ${space(2)};
  padding: ${space(3)};
  border-radius: ${theme.borderRadius.md};
  background: ${tint.warning.bg};
  border: 1px solid ${tint.warning.border};
  color: ${color('neutral800')};

  svg {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
  }

  svg path {
    fill: ${tint.warning.fg};
  }
`;

const MonoInput = styled(TextInput)`
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
`;

/**
 * IP bans tab: lists blocked IP addresses. Banning and unbanning need manage
 * access (plugin::magic-link.manage, enforced by the server).
 */
const IPBans = () => {
  const { t } = useMagicLinkIntl();
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const { canRead, canManage, isLoading: isLoadingPermissions, error: permissionError } = useMagicLinkRBAC();

  const [bannedIPs, setBannedIPs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newIP, setNewIP] = useState('');
  const [isBanning, setIsBanning] = useState(false);
  const [pendingUnban, setPendingUnban] = useState(null);

  const normalizedNewIP = normalizeIpAddress(newIP);
  const discard = useDiscardGuard(showAddModal && newIP.trim() !== '');

  const notify = useCallback(
    (type, message) =>
      toggleNotification({
        type,
        title:
          type === 'success'
            ? t('ipban.notifications.successTitle', 'Success')
            : t('ipban.notifications.errorTitle', 'Error'),
        message,
      }),
    [t, toggleNotification]
  );

  /** Loads the ban list. Returns true on success. */
  const fetchBannedIPs = useCallback(async () => {
    try {
      const response = await get('/magic-link/banned-ips');
      const ips = response?.data?.ips;
      setBannedIPs(Array.isArray(ips) ? ips.filter((ip) => typeof ip === 'string') : []);
      setLoadError(false);
      return true;
    } catch {
      setLoadError(true);
      return false;
    }
  }, [get]);

  useEffect(() => {
    if (isLoadingPermissions) return undefined;
    if (!canRead) {
      setIsLoading(false);
      return undefined;
    }
    let active = true;
    fetchBannedIPs().then((ok) => {
      if (!active) return;
      setIsLoading(false);
      if (!ok) notify('danger', t('ipban.notifications.loadError', 'Banned IP addresses could not be loaded.'));
    });
    return () => {
      active = false;
    };
  }, [canRead, isLoadingPermissions, fetchBannedIPs, notify, t]);

  const stats = useMemo(() => getIpStats(bannedIPs), [bannedIPs]);
  const filteredIPs = useMemo(() => filterIps(bannedIPs, searchQuery), [bannedIPs, searchQuery]);
  const pageCount = getPageCount(filteredIPs.length, pageSize);
  const safePage = clampPage(currentPage, pageCount);
  const pageIPs = useMemo(() => paginate(filteredIPs, safePage, pageSize), [filteredIPs, safePage, pageSize]);

  const handleSearch = (value) => {
    setSearchQuery(value);
    setCurrentPage(1);
  };

  const handlePageSize = (value) => {
    setPageSize(value);
    setCurrentPage(1);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    const ok = await fetchBannedIPs();
    setIsRefreshing(false);
    notify(
      ok ? 'success' : 'danger',
      ok
        ? t('ipban.notifications.refreshSuccess', 'IP list updated')
        : t('ipban.notifications.loadError', 'Banned IP addresses could not be loaded.')
    );
  };

  const closeModal = () => {
    setShowAddModal(false);
    setNewIP('');
  };

  const handleBanIP = async (event) => {
    event?.preventDefault?.();
    if (!canManage || isBanning) return;
    if (!normalizedNewIP) return;
    setIsBanning(true);
    try {
      await post('/magic-link/ban-ip', { data: { ip: normalizedNewIP } });
      closeModal();
      notify('success', t('ipban.notifications.banSuccess', 'IP {ip} has been banned', { ip: normalizedNewIP }));
      await fetchBannedIPs();
    } catch {
      notify('danger', t('ipban.notifications.banError', 'Error banning IP'));
    } finally {
      setIsBanning(false);
    }
  };

  /** Removes an IP from the ban list after the ConfirmDialog. */
  const handleUnbanIP = async (ip) => {
    if (!canManage) return;
    try {
      await post('/magic-link/unban-ip', { data: { ip } });
      setPendingUnban(null);
      notify('success', t('ipban.notifications.unbanSuccess', 'IP {ip} has been unbanned', { ip }));
      await fetchBannedIPs();
    } catch {
      notify('danger', t('ipban.notifications.unbanError', 'Error unbanning IP'));
    }
  };

  const heading = <VisuallyHidden tag="h2">{t('ipban.title', 'Banned IP addresses')}</VisuallyHidden>;

  if (isLoadingPermissions || isLoading) {
    return (
      <Box>
        {heading}
        <LoadingState label={t('common.loadingBannedIPs', 'Loading banned IP addresses...')} />
      </Box>
    );
  }

  if (permissionError || !canRead) {
    return (
      <Box>
        {heading}
        <Alert variant="danger" closeLabel={t('common.close', 'Close')}>
          {permissionError
            ? t('common.permissions.loadError', 'Your permissions could not be loaded. Reload the page to try again.')
            : t('ipban.permission.denied', 'You do not have permission to view banned IP addresses.')}
        </Alert>
      </Box>
    );
  }

  const ipError = newIP.trim() && !normalizedNewIP ? t('ipban.modal.invalidIP', 'Please enter a valid IP address') : undefined;

  return (
    <Box paddingBottom={7}>
      {heading}

      <StatsRow
        label={t('ipban.stats.label', 'Ban statistics')}
        items={[
          { key: 'total', label: t('ipban.stats.total', 'Banned IPs'), value: stats.total, icon: Lock, tone: 'danger' },
          { key: 'ipv4', label: t('ipban.stats.ipv4', 'IPv4 addresses'), value: stats.ipv4, icon: Earth, tone: 'primary' },
          { key: 'ipv6', label: t('ipban.stats.ipv6', 'IPv6 addresses'), value: stats.ipv6, icon: Server, tone: 'secondary' },
        ]}
      />

      <FilterBar role="search" aria-label={t('ipban.filters.label', 'Filter banned IP addresses')}>
        <FilterSearch>
          <Searchbar
            name="ip-search"
            autoComplete="off"
            value={searchQuery}
            onChange={(event) => handleSearch(event.target.value)}
            onClear={() => handleSearch('')}
            clearLabel={t('common.search.clear', 'Clear search')}
            placeholder={t('common.searchIPPlaceholder', 'Search by IP address...')}
          >
            {t('ipban.search.label', 'Search banned IP addresses')}
          </Searchbar>
        </FilterSearch>
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
            {t('ipban.actions.refresh', 'Refresh')}
          </Button>
          {canManage ? (
            <Button
              onClick={() => setShowAddModal(true)}
              startIcon={<Plus aria-hidden="true" />}
              variant="danger"
              size="L"
            >
              {t('ipban.actions.ban', 'Ban IP')}
            </Button>
          ) : null}
        </FilterActions>
      </FilterBar>

      <DataTable aria-label={t('ipban.title', 'Banned IP addresses')}>
        {loadError && bannedIPs.length === 0 ? (
          <LoadErrorState
            message={t('ipban.notifications.loadError', 'Banned IP addresses could not be loaded.')}
            onRetry={handleRefresh}
            isRetrying={isRefreshing}
          />
        ) : filteredIPs.length === 0 ? (
          bannedIPs.length > 0 ? (
            <EmptyState
              icon={Earth}
              title={t('ipban.empty.noMatches.title', 'No banned IP matches your search')}
              description={t('ipban.empty.noMatches.description', 'Check the address or clear the search.')}
              actions={
                <Button onClick={() => handleSearch('')} variant="secondary" size="L">
                  {t('ipban.empty.clearSearch', 'Clear search')}
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Earth}
              tone="success"
              title={t('ipban.empty.title', 'No Banned IPs')}
              description={
                canManage
                  ? t('ipban.empty.description', 'No IP addresses are currently banned. Add an IP to block it.')
                  : t('ipban.empty.descriptionReadOnly', 'No IP addresses are currently banned.')
              }
              actions={
                canManage ? (
                  <Button
                    onClick={() => setShowAddModal(true)}
                    startIcon={<Plus aria-hidden="true" />}
                    variant="danger"
                    size="L"
                  >
                    {t('ipban.empty.action', 'Ban first IP')}
                  </Button>
                ) : null
              }
            />
          )
        ) : (
          <>
            <StyledTable $hover="danger" colCount={canManage ? 3 : 2} rowCount={pageIPs.length + 1}>
              <Thead>
                <Tr>
                  <Th>{t('common.tableHeaders.ipAddress', 'IP Address')}</Th>
                  <Th>{t('common.status', 'Status')}</Th>
                  {canManage ? (
                    <Th>
                      <VisuallyHidden>{t('common.actions', 'Actions')}</VisuallyHidden>
                    </Th>
                  ) : null}
                </Tr>
              </Thead>
              <Tbody>
                {pageIPs.map((ip) => (
                  <Tr key={ip}>
                    <Td data-label={t('common.tableHeaders.ipAddress', 'IP Address')}>
                      <Flex alignItems="center" gap={2} style={{ minWidth: 0 }}>
                        <Avatar $background={brand.danger} aria-hidden="true">
                          <Lock />
                        </Avatar>
                        <MonoText>{ip}</MonoText>
                      </Flex>
                    </Td>
                    <Td data-label={t('common.status', 'Status')}>
                      <Badge variant="danger">{t('ipban.status.banned', 'Banned')}</Badge>
                    </Td>
                    {canManage ? (
                      <Td data-label="">
                        <Flex gap={1} justifyContent="flex-end">
                          <IconButton
                            label={t('ipban.actions.unbanFor', 'Unban {ip}', { ip })}
                            variant="success-light"
                            onClick={() => setPendingUnban(ip)}
                          >
                            <Check aria-hidden="true" />
                          </IconButton>
                        </Flex>
                      </Td>
                    ) : null}
                  </Tr>
                ))}
              </Tbody>
            </StyledTable>
            <TablePagination
              page={safePage}
              pageCount={pageCount}
              total={filteredIPs.length}
              pageSize={pageSize}
              onChange={setCurrentPage}
            />
          </>
        )}
      </DataTable>

      {canManage ? (
        <Modal.Root
          open={showAddModal}
          onOpenChange={(open) => {
            if (!open) discard.runGuarded(closeModal);
          }}
        >
          <Modal.Content>
            <form onSubmit={handleBanIP} noValidate>
              <Modal.Header closeLabel={t('common.close', 'Close')}>
                <Flex direction="column" alignItems="flex-start" gap={1}>
                  <Modal.Title>{t('ipban.modal.title', 'Ban IP Address')}</Modal.Title>
                  <Typography variant="pi" textColor="neutral600">
                    {t('ipban.modal.subtitle', 'Add an IP address to the block list')}
                  </Typography>
                </Flex>
              </Modal.Header>
              <Modal.Body>
                <Flex direction="column" alignItems="stretch" gap={4}>
                  <WarningBox role="note">
                    <WarningCircle aria-hidden="true" />
                    <Typography variant="pi" textColor="neutral800">
                      {t(
                        'ipban.modal.warning',
                        'Warning: This IP address will be immediately blocked and all associated tokens will be deactivated.'
                      )}
                    </Typography>
                  </WarningBox>
                  <Field.Root
                    name="ban-ip-address"
                    required
                    error={ipError}
                    hint={t('ipban.modal.hint', 'Enter an IPv4 or IPv6 address')}
                  >
                    <Field.Label>{t('ipban.modal.label', 'IP Address')}</Field.Label>
                    <MonoInput
                      autoFocus
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={t('ipban.modal.placeholder', 'e.g. 192.168.1.1')}
                      value={newIP}
                      onChange={(event) => setNewIP(event.target.value)}
                    />
                    <Field.Error />
                    <Field.Hint />
                  </Field.Root>
                </Flex>
              </Modal.Body>
              <Modal.Footer>
                <Button type="button" size="M" variant="tertiary" onClick={() => discard.runGuarded(closeModal)}>
                  {t('ipban.modal.cancel', 'Cancel')}
                </Button>
                <Button
                  type="submit"
                  size="M"
                  variant="danger"
                  startIcon={<Lock aria-hidden="true" />}
                  disabled={!normalizedNewIP}
                  loading={isBanning}
                >
                  {t('ipban.modal.submit', 'Ban IP')}
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Content>
        </Modal.Root>
      ) : null}

      <UnsavedChangesDialog guard={discard} />

      <ConfirmDialog
        isOpen={canManage && pendingUnban !== null}
        variant="default"
        title={t('ipban.dialog.unban.title', 'Unban IP address?')}
        description={t(
          'ipban.dialog.unban.body',
          'Requests from {ip} are allowed again. Deactivated tokens stay deactivated.',
          { ip: pendingUnban ?? '' }
        )}
        confirmLabel={t('ipban.actions.unban', 'Unban')}
        confirmIcon={<Check aria-hidden="true" />}
        onConfirm={() => handleUnbanIP(pendingUnban)}
        onClose={() => setPendingUnban(null)}
      />
    </Box>
  );
};

export default IPBans;
