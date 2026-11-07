import { useMemo, useState } from 'react';
import { Button, Flex, Typography } from '@strapi/design-system';
import { Check, Lock, Plus, Trash } from '@strapi/icons';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import { ConfirmDialog } from '../../components/shared/ConfirmDialog';
import { useMagicLinkIntl } from '../../hooks/useMagicLinkIntl';
import ExtendTokenModal from './ExtendTokenModal';
import { TokenDetailsModal } from './components/TokenDetailsModal';
import { TokenStats } from './components/TokenStatus';
import { TokensFilterBar } from './components/TokensFilterBar';
import { TokensTable } from './components/TokensTable';
import { ActionBar } from './components/tokenStyles';
import {
  clampPage,
  computeTokenStats,
  filterAndSortTokens,
  getTokenKey,
  buildReissueTokenBody,
  summarizeBulkResults,
} from './tokenModel';

/**
 * "Magic links" tab: stats, filters, table, details, extend and the
 * confirmation dialogs for every destructive or email-sending action.
 *
 * @param {object} props
 * @param {object[]} props.tokens
 * @param {boolean} props.isLoading
 * @param {unknown} props.error
 * @param {() => Promise<boolean>} props.refetch
 * @param {boolean} props.canManage
 * @param {() => void} props.onCreate
 * @param {(responseData: object, email: string) => void} props.onTokenIssued
 */
export const MagicLinksPanel = ({
  tokens,
  isLoading,
  error,
  refetch,
  canManage,
  onCreate,
  onTokenIssued,
}) => {
  const { t } = useMagicLinkIntl();
  const { post, del } = useFetchClient();
  const { toggleNotification } = useNotification();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ sortBy: 'createdAt', sortOrder: 'desc' });
  const [selectedKeys, setSelectedKeys] = useState([]);
  const [detailsToken, setDetailsToken] = useState(null);
  const [extendToken, setExtendToken] = useState(null);
  /** @type {[{type: 'delete'|'bulkDelete'|'block'|'activate'|'reissue', token?: object, keys?: string[]}|null, Function]} */
  const [pending, setPending] = useState(null);

  const stats = useMemo(() => computeTokenStats(tokens), [tokens]);
  const filtered = useMemo(
    () => filterAndSortTokens(tokens, { search, status, ...sort }),
    [tokens, search, status, sort]
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = clampPage(page, pageCount);
  const rows = useMemo(
    () => filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filtered, safePage, pageSize]
  );

  // Adjust state during render instead of in effects
  // (https://react.dev/learn/you-might-not-need-an-effect): keep the page in
  // range, and drop selected or opened tokens that no longer exist after a
  // refetch.
  if (page !== safePage) setPage(safePage);

  const [seenTokens, setSeenTokens] = useState(tokens);
  if (seenTokens !== tokens) {
    setSeenTokens(tokens);
    const existing = new Set(tokens.map(getTokenKey));
    setSelectedKeys((keys) => {
      const next = keys.filter((key) => existing.has(key));
      return next.length === keys.length ? keys : next;
    });
    setDetailsToken((current) =>
      current
        ? (tokens.find((token) => getTokenKey(token) === getTokenKey(current)) ?? null)
        : current
    );
  }

  const resetView = () => {
    setPage(1);
    setSelectedKeys([]);
  };

  const notify = (type, message) => toggleNotification({ type, message });

  /* --------------------------------------------------------- API calls */

  const deleteToken = async (token) => {
    if (!canManage) return;
    const tokenId = getTokenKey(token);
    try {
      await del(`/magic-link/tokens/${tokenId}`);
      setPending(null);
      setDetailsToken(null);
      notify('success', t('tokens.notifications.deleted', 'Token deleted'));
      await refetch();
    } catch {
      notify('warning', t('tokens.notifications.deleteError', 'The token could not be deleted.'));
    }
  };

  const bulkDelete = async (keys) => {
    if (!canManage || keys.length === 0) return;
    const results = await Promise.allSettled(
      keys.map((tokenId) => del(`/magic-link/tokens/${tokenId}`))
    );
    const { succeeded, failed, total } = summarizeBulkResults(keys, results);
    setPending(null);
    setSelectedKeys(failed);
    if (failed.length === 0) {
      notify(
        'success',
        t(
          'tokens.notifications.bulkDeleted',
          '{count, plural, one {# token deleted} other {# tokens deleted}}',
          {
            count: succeeded.length,
          }
        )
      );
    } else {
      notify(
        'warning',
        t(
          'tokens.notifications.bulkPartial',
          '{deleted} of {total} tokens deleted. The others are still selected.',
          {
            deleted: succeeded.length,
            total,
          }
        )
      );
    }
    await refetch();
  };

  const blockToken = async (token) => {
    if (!canManage) return;
    const tokenId = getTokenKey(token);
    try {
      await post(`/magic-link/tokens/${tokenId}/block`);
      setPending(null);
      setDetailsToken(null);
      notify('success', t('tokens.notifications.blockSuccess', 'Token blocked'));
      await refetch();
    } catch {
      notify('warning', t('tokens.notifications.blockError', 'The token could not be blocked.'));
    }
  };

  const activateToken = async (token) => {
    if (!canManage) return;
    const tokenId = getTokenKey(token);
    try {
      await post(`/magic-link/tokens/${tokenId}/activate`);
      setPending(null);
      setDetailsToken(null);
      notify('success', t('tokens.notifications.activateSuccess', 'Token activated'));
      await refetch();
    } catch {
      notify(
        'warning',
        t('tokens.notifications.activateError', 'The token could not be activated.')
      );
    }
  };

  const reissueToken = async (token) => {
    if (!canManage) return;
    try {
      const response = await post('/magic-link/tokens', buildReissueTokenBody(token));
      setPending(null);
      setDetailsToken(null);
      notify(
        'success',
        t('tokens.notifications.reactivateSuccess', 'New token created and sent to {email}', {
          email: token.email,
        })
      );
      onTokenIssued(response?.data, token.email);
      await refetch();
    } catch {
      notify(
        'warning',
        t('tokens.notifications.reactivateError', 'The new token could not be created.')
      );
    }
  };

  const extend = async (token, days) => {
    if (!canManage) return;
    const tokenId = getTokenKey(token);
    try {
      await post(`/magic-link/tokens/${tokenId}/extend`, { days });
      setExtendToken(null);
      notify(
        'success',
        t(
          'tokens.notifications.extended',
          'Token extended by {days, plural, one {# day} other {# days}}',
          { days }
        )
      );
      await refetch();
    } catch {
      notify('warning', t('tokens.notifications.extendError', 'The token could not be extended.'));
    }
  };

  /* --------------------------------------------------- confirmations */

  const confirmConfig = (() => {
    if (!pending) return null;
    const email = pending.token?.email ?? '';
    switch (pending.type) {
      case 'delete':
        return {
          title: t('tokens.delete.title', 'Delete token?'),
          description: t(
            'tokens.delete.body',
            'The login link for {email} stops working immediately. This cannot be undone.',
            { email }
          ),
          confirmLabel: t('common.delete', 'Delete'),
          confirmIcon: <Trash />,
          onConfirm: () => deleteToken(pending.token),
        };
      case 'bulkDelete':
        return {
          title: t('tokens.bulkDelete.title', 'Delete selected tokens?'),
          description: t(
            'tokens.confirm.bulkDelete',
            'Delete {count, plural, one {# selected token} other {# selected tokens}}? This cannot be undone.',
            { count: pending.keys.length }
          ),
          confirmLabel: t('common.delete', 'Delete'),
          confirmIcon: <Trash />,
          onConfirm: () => bulkDelete(pending.keys),
        };
      case 'block':
        return {
          title: t('tokens.block.title', 'Block token?'),
          description: t(
            'tokens.block.body',
            'The login link for {email} stops working until you activate it again.',
            { email }
          ),
          confirmLabel: t('tokens.actions.block', 'Block'),
          confirmIcon: <Lock />,
          onConfirm: () => blockToken(pending.token),
        };
      case 'activate':
        return {
          title: t('tokens.activate.title', 'Activate token?'),
          description: t(
            'tokens.activate.body',
            'The login link for {email} works again until it expires.',
            { email }
          ),
          confirmLabel: t('tokens.actions.activate', 'Activate'),
          confirmIcon: <Check />,
          variant: 'default',
          onConfirm: () => activateToken(pending.token),
        };
      case 'reissue':
        return {
          title: t('tokens.reissue.title', 'Create a new token?'),
          description: t(
            'tokens.reissue.body',
            'A new login link for {email} is created with the default validity and sent by email right away.',
            { email }
          ),
          confirmLabel: t('tokens.reissue.confirm', 'Create and send'),
          confirmIcon: <Plus />,
          variant: 'default',
          onConfirm: () => reissueToken(pending.token),
        };
      default:
        return null;
    }
  })();

  const hasFilters = search.trim() !== '' || status !== 'all';

  return (
    <>
      <TokenStats stats={stats} />

      <TokensFilterBar
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          resetView();
        }}
        status={status}
        onStatusChange={(value) => {
          setStatus(value);
          resetView();
        }}
        pageSize={pageSize}
        onPageSizeChange={(value) => {
          setPageSize(value);
          resetView();
        }}
      />

      {canManage && selectedKeys.length > 0 ? (
        <ActionBar role="region" aria-label={t('tokens.bulk.label', 'Bulk actions')}>
          <Typography fontWeight="semiBold" textColor="neutral800" aria-live="polite">
            {t(
              'tokens.selected',
              '{count, plural, one {# token selected} other {# tokens selected}}',
              {
                count: selectedKeys.length,
              }
            )}
          </Typography>
          <Flex gap={2} wrap="wrap">
            <Button variant="tertiary" size="M" onClick={() => setSelectedKeys([])}>
              {t('common.clearSelection', 'Clear selection')}
            </Button>
            <Button
              variant="danger"
              size="M"
              startIcon={<Trash />}
              onClick={() => setPending({ type: 'bulkDelete', keys: [...selectedKeys] })}
            >
              {t('tokens.actions.bulkDelete', 'Delete Selected')}
            </Button>
          </Flex>
        </ActionBar>
      ) : null}

      <TokensTable
        rows={rows}
        totalCount={tokens.length}
        isLoading={isLoading}
        error={error}
        onRetry={refetch}
        hasFilters={hasFilters}
        onResetFilters={() => {
          setSearch('');
          setStatus('all');
          resetView();
        }}
        canManage={canManage}
        onCreate={onCreate}
        selectedKeys={selectedKeys}
        onToggleRow={(key, checked) =>
          setSelectedKeys((keys) =>
            checked ? [...new Set([...keys, key])] : keys.filter((k) => k !== key)
          )
        }
        onToggleAllVisible={(keys, checked) =>
          setSelectedKeys((current) =>
            checked
              ? [...new Set([...current, ...keys])]
              : current.filter((key) => !keys.includes(key))
          )
        }
        sort={sort}
        onSort={(field) =>
          setSort((current) =>
            current.sortBy === field
              ? { sortBy: field, sortOrder: current.sortOrder === 'asc' ? 'desc' : 'asc' }
              : { sortBy: field, sortOrder: 'asc' }
          )
        }
        page={safePage}
        pageCount={pageCount}
        onPageChange={(next) => setPage(clampPage(next, pageCount))}
        onView={setDetailsToken}
        onExtend={setExtendToken}
        onDelete={(token) => setPending({ type: 'delete', token })}
      />

      <TokenDetailsModal
        token={extendToken ? null : detailsToken}
        canManage={canManage}
        onClose={() => setDetailsToken(null)}
        onReissue={(token) => setPending({ type: 'reissue', token })}
        onExtend={(token) => {
          setDetailsToken(null);
          setExtendToken(token);
        }}
        onBlock={(token) => setPending({ type: 'block', token })}
        onActivate={(token) => setPending({ type: 'activate', token })}
        onDelete={(token) => setPending({ type: 'delete', token })}
      />

      {canManage ? (
        <ExtendTokenModal
          token={extendToken}
          onClose={() => setExtendToken(null)}
          onSubmit={extend}
        />
      ) : null}

      <ConfirmDialog
        isOpen={canManage && confirmConfig !== null}
        title={confirmConfig?.title}
        description={confirmConfig?.description}
        confirmLabel={confirmConfig?.confirmLabel}
        confirmIcon={confirmConfig?.confirmIcon}
        variant={confirmConfig?.variant ?? 'danger'}
        onConfirm={confirmConfig?.onConfirm}
        onClose={() => setPending(null)}
      />
    </>
  );
};

export default MagicLinksPanel;
