import { useState, useEffect, useCallback, useMemo } from 'react';
import styled, { keyframes } from 'styled-components';
import { useIntl } from 'react-intl';
import {
  Typography,
  Box,
  Flex,
  Button,
  Loader,
  Table,
  Thead,
  Tbody,
  Tr,
  Td,
  Th,
  Badge,
  Searchbar,
  SingleSelect,
  SingleSelectOption,
  Pagination,
  PreviousLink,
  PageLink,
  NextLink,
  Checkbox,
  IconButton,
} from '@strapi/design-system';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import {
  ArrowClockwise,
  Shield,
  User,
  Calendar,
  Clock,
  Trash,
  Eye,
  Lock,
  Check,
  Cross,
  CaretDown,
  Monitor,
} from '@strapi/icons';
import getTrad from '../../utils/getTrad';

// ================ DESIGN TOKENS ================
const theme = {
  colors: {
    primary: { 600: '#0284C7', 500: '#0EA5E9', 100: '#E0F2FE', 50: '#F0F9FF' },
    success: { 600: '#16A34A', 500: '#22C55E', 100: '#DCFCE7', 50: '#F0FDF4' },
    warning: { 600: '#D97706', 500: '#F59E0B', 100: '#FEF3C7', 50: '#FFFBEB' },
    danger: { 600: '#DC2626', 500: '#EF4444', 100: '#FEE2E2', 50: '#FEF2F2' },
    neutral: {
      0: '#FFFFFF',
      50: '#F9FAFB',
      100: '#F3F4F6',
      200: '#E5E7EB',
      500: '#6B7280',
      600: '#4B5563',
      700: '#374151',
      800: '#1F2937',
      900: '#111827',
    }
  },
  shadows: {
    sm: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
    md: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
    xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
  },
  transitions: {
    fast: '150ms cubic-bezier(0.4, 0, 0.2, 1)',
    normal: '300ms cubic-bezier(0.4, 0, 0.2, 1)',
  },
  spacing: {
    md: '16px',
    lg: '24px',
    xl: '32px',
  },
  borderRadius: {
    md: '8px',
    lg: '12px',
    xl: '16px',
    full: '9999px',
  }
};

// ================ ANIMATIONEN ================
const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
`;

const rotate = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

const float = keyframes`
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-5px); }
`;

// ================ STYLED COMPONENTS ================
const Container = styled(Box)`
  animation: ${fadeIn} 0.5s;
  min-height: calc(100vh - 200px);
  background: transparent;
`;

const StatsGrid = styled(Box)`
  margin-bottom: ${theme.spacing.xl};
  display: flex;
  gap: ${theme.spacing.md};
  justify-content: center;
  flex-wrap: wrap;
  max-width: 1200px;
  margin-left: auto;
  margin-right: auto;

  @media screen and (max-width: 768px) {
    display: grid !important;
    grid-template-columns: repeat(2, 1fr) !important;
    gap: 12px !important;
    max-width: 100% !important;
    margin-bottom: 24px !important;
    padding: 0 12px !important;
  }
`;

const StatCard = styled(Box)`
  background: ${props => props.theme.colors.neutral0};
  border-radius: ${theme.borderRadius.lg};
  padding: ${theme.spacing.lg};
  transition: all ${theme.transitions.normal};
  animation: ${fadeIn} 0.5s backwards;
  animation-delay: ${props => props.$delay || '0s'};
  box-shadow: ${theme.shadows.sm};
  border: 1px solid ${props => props.theme.colors.neutral200};
  min-width: 220px;
  max-width: 260px;
  flex: 1;
  
  &:hover {
    transform: translateY(-4px);
    box-shadow: ${theme.shadows.xl};
    border-color: ${props => props.$color || theme.colors.primary[500]};
    
    .stat-icon {
      transform: rotate(10deg) scale(1.1);
    }
  }

  @media screen and (max-width: 768px) {
    min-width: unset !important;
    max-width: unset !important;
    width: 100% !important;
    padding: 16px !important;
    
    &:hover {
      transform: none !important;
    }
  }
`;

const StatIcon = styled(Box)`
  width: 48px;
  height: 48px;
  border-radius: ${theme.borderRadius.md};
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${props => props.$bg};
  transition: all ${theme.transitions.normal};
  
  svg {
    width: 24px;
    height: 24px;
    color: ${props => props.$color};
  }
`;

const StatValue = styled(Typography)`
  font-size: 2rem;
  font-weight: 700;
  color: ${props => props.theme.colors.neutral800};
  margin: ${theme.spacing.md} 0 4px;
`;

const StatLabel = styled(Typography)`
  font-size: 0.875rem;
  color: ${props => props.theme.colors.neutral600};
  font-weight: 500;
`;

const DataTable = styled(Box)`
  background: ${props => props.theme.colors.neutral0};
  border-radius: ${theme.borderRadius.xl};
  overflow: hidden;
  box-shadow: ${theme.shadows.sm};
  border: 1px solid ${props => props.theme.colors.neutral200};
`;

const StyledTable = styled(Table)`
  thead {
    background: ${props => props.theme.colors.neutral50};
    border-bottom: 1px solid ${props => props.theme.colors.neutral200};
    
    th {
      font-weight: 600;
      color: ${props => props.theme.colors.neutral800};
      font-size: 0.875rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: ${theme.spacing.md};
    }
  }
  
  tbody tr {
    transition: all ${theme.transitions.fast};
    border-bottom: 1px solid ${props => props.theme.colors.neutral100};
    
    &:hover {
      background: ${props => props.theme.colors.primary100};
    }
    
    td {
      padding: ${theme.spacing.md};
      color: ${props => props.theme.colors.neutral800};
    }
  }

  /* Mobile Card Layout */
  @media screen and (max-width: 768px) {
    display: block !important;
    
    thead {
      display: none !important;
    }
    
    tbody {
      display: block !important;
    }
    
    tr {
      display: block !important;
      margin-bottom: 16px !important;
      border: 2px solid #E5E7EB !important;
      border-radius: 12px !important;
      padding: 16px !important;
      background: white !important;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1) !important;
    }
    
    td {
      display: flex !important;
      justify-content: space-between !important;
      align-items: center !important;
      padding: 8px 0 !important;
      border: none !important;
      
      &:not(:last-child) {
        border-bottom: 1px solid #E5E7EB !important;
        padding-bottom: 8px !important;
        margin-bottom: 8px !important;
      }
      
      &::before {
        content: attr(data-label) !important;
        font-weight: 600 !important;
        color: #6B7280 !important;
        font-size: 11px !important;
        text-transform: uppercase !important;
        letter-spacing: 0.5px !important;
        flex-shrink: 0 !important;
      }
      
      &[data-label=""]::before {
        display: none !important;
      }
    }
  }
`;

const AnimatedBadge = styled(Badge)`
  font-weight: 600;
  padding: 4px 8px;
  transition: transform ${theme.transitions.fast};
  
  &:hover {
    transform: scale(1.05);
  }
`;

const EmptyState = styled(Box)`
  background: ${props => props.theme.colors.neutral0};
  border-radius: ${theme.borderRadius.xl};
  padding: 64px;
  text-align: center;
  border: 2px dashed ${props => props.theme.colors.neutral300};
  min-height: 400px;
  display: flex;
  align-items: center;
  justify-content: center;
  
  &::after {
    content: '🔐';
    position: absolute;
    bottom: 40px;
    right: 40px;
    font-size: 72px;
    opacity: 0.08;
    animation: ${float} 4s ease-in-out infinite;
  }
`;

const FilterBar = styled(Flex)`
  background: ${props => props.theme.colors.neutral0};
  border-radius: ${theme.borderRadius.lg};
  padding: ${theme.spacing.md};
  margin-bottom: ${theme.spacing.lg};
  box-shadow: ${theme.shadows.sm};
  border: 1px solid ${props => props.theme.colors.neutral200};
`;

const ActionBar = styled(Flex)`
  padding: ${theme.spacing.md};
  background: ${props => props.theme.colors.primary100};
  border-radius: ${theme.borderRadius.lg};
  margin-bottom: ${theme.spacing.md};
`;

const LoadingOverlay = styled(Flex)`
  min-height: 400px;
  justify-content: center;
  align-items: center;
  
  .loader-icon {
    animation: ${rotate} 1s linear infinite;
  }
`;

// ================ HELPER FUNKTIONEN ================
const formatDate = (dateString) => {
  if (!dateString) return '—';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '—';
  
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
};

// ================ HAUPTKOMPONENTE ================
const JWTSessions = () => {
  const { formatMessage } = useIntl();
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  
  // States
  const [sessions, setSessions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedSessions, setSelectedSessions] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');
  
  // Stats berechnen
  const stats = useMemo(() => ({
    total: sessions.length,
    active: sessions.filter(s => !s.revoked && !s.isExpired).length,
    expired: sessions.filter(s => s.isExpired).length,
    revoked: sessions.filter(s => s.revoked).length,
  }), [sessions]);
  
  // Gefilterte und sortierte Sessions
  const filteredAndSortedSessions = useMemo(() => {
    let filtered = sessions;
    
    // Search Filter
    if (searchQuery) {
      filtered = filtered.filter(session =>
        session.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        session.username?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        session.ipAddress?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    
    // Status Filter
    if (filterStatus !== 'all') {
      filtered = filtered.filter(session => {
        switch (filterStatus) {
          case 'active':
            return !session.revoked && !session.isExpired;
          case 'expired':
            return session.isExpired;
          case 'revoked':
            return session.revoked;
          default:
            return true;
        }
      });
    }
    
    // Sortierung
    filtered.sort((a, b) => {
      const aValue = a[sortBy];
      const bValue = b[sortBy];
      
      if (sortOrder === 'asc') {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });
    
    return filtered;
  }, [sessions, searchQuery, filterStatus, sortBy, sortOrder]);
  
  // Pagination
  const paginatedSessions = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    return filteredAndSortedSessions.slice(start, end);
  }, [filteredAndSortedSessions, currentPage, pageSize]);
  
  const totalPages = Math.ceil(filteredAndSortedSessions.length / pageSize);
  
  // Stat Cards Konfiguration
  const statCards = [
    {
      title: formatMessage({ id: getTrad('jwt.stats.total') }),
      value: stats.total,
      icon: Shield,
      color: theme.colors.primary[600],
      bg: theme.colors.primary[100],
      delay: '0s'
    },
    {
      title: formatMessage({ id: getTrad('jwt.stats.active') }),
      value: stats.active,
      icon: Check,
      color: theme.colors.success[600],
      bg: theme.colors.success[100],
      delay: '0.1s'
    },
    {
      title: formatMessage({ id: getTrad('jwt.stats.expired') }),
      value: stats.expired,
      icon: Clock,
      color: theme.colors.warning[600],
      bg: theme.colors.warning[100],
      delay: '0.2s'
    },
    {
      title: formatMessage({ id: getTrad('jwt.stats.revoked') }),
      value: stats.revoked,
      icon: Lock,
      color: theme.colors.danger[600],
      bg: theme.colors.danger[100],
      delay: '0.3s'
    }
  ];
  
  // Fetch Functions
  const fetchSessions = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await get('/magic-link/jwt-sessions');
      setSessions(response?.data || []);
    } catch (error) {
      console.error('Error fetching JWT sessions:', error);
      toggleNotification({
        type: 'warning',
        message: 'Fehler beim Laden der JWT Sessions',
        title: 'Fehler'
      });
    } finally {
      setIsLoading(false);
    }
  }, [get, toggleNotification]);
  
  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);
  
  // Handlers
  const handleRefresh = () => {
    fetchSessions();
    toggleNotification({
      type: 'success',
      message: formatMessage({ id: getTrad('jwt.notifications.refreshSuccess') }),
      title: formatMessage({ id: getTrad('tokens.notifications.success') })
    });
  };
  
  const handleRevoke = async (sessionId) => {
    try {
      await post('/magic-link/revoke-jwt', { sessionId });
      await fetchSessions();
      toggleNotification({
        type: 'success',
        message: 'Session wurde gesperrt',
        title: 'Erfolg'
      });
    } catch (error) {
      toggleNotification({
        type: 'warning',
        message: formatMessage({ id: getTrad('jwt.notifications.revokeError') }),
        title: formatMessage({ id: getTrad('tokens.notifications.error') })
      });
    }
  };
  
  const handleUnrevoke = async (sessionId, userId) => {
    try {
      await post('/magic-link/unrevoke-jwt', { sessionId, userId });
      await fetchSessions();
      toggleNotification({
        type: 'success',
        message: formatMessage({ id: getTrad('jwt.notifications.unrevokeSuccess') }),
        title: formatMessage({ id: getTrad('tokens.notifications.success') })
      });
    } catch (error) {
      toggleNotification({
        type: 'warning',
        message: formatMessage({ id: getTrad('jwt.notifications.unrevokeError') }),
        title: formatMessage({ id: getTrad('tokens.notifications.error') })
      });
    }
  };
  
  const handleCleanup = async () => {
    try {
      const response = await post('/magic-link/cleanup-sessions');
      await fetchSessions();
      toggleNotification({
        type: 'success',
        message: response?.data?.message || formatMessage({ id: getTrad('jwt.notifications.cleanupSuccess') }),
        title: formatMessage({ id: getTrad('tokens.notifications.success') })
      });
    } catch (error) {
      toggleNotification({
        type: 'warning',
        message: formatMessage({ id: getTrad('jwt.notifications.cleanupError') }),
        title: formatMessage({ id: getTrad('tokens.notifications.error') })
      });
    }
  };
  
  const handleSelectAll = (checked) => {
    if (checked) {
      setSelectedSessions(paginatedSessions.map(session => session.id));
    } else {
      setSelectedSessions([]);
    }
  };
  
  const handleSelectSession = (sessionId, checked) => {
    if (checked) {
      setSelectedSessions([...selectedSessions, sessionId]);
    } else {
      setSelectedSessions(selectedSessions.filter(id => id !== sessionId));
    }
  };
  
  const handleSort = (field) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };
  
  const getStatusBadge = (session) => {
    if (session.revoked) {
      return <AnimatedBadge variant="danger">{formatMessage({ id: getTrad('jwt.status.revoked') })}</AnimatedBadge>;
    }
    if (session.isExpired) {
      return <AnimatedBadge variant="warning">{formatMessage({ id: getTrad('jwt.status.expired') })}</AnimatedBadge>;
    }
    return <AnimatedBadge variant="success">{formatMessage({ id: getTrad('jwt.status.active') })}</AnimatedBadge>;
  };
  
  // Loading State
  if (isLoading) {
    return (
      <Container>
        <LoadingOverlay>
          <Box className="loader-icon">
            <Loader>{formatMessage({ id: getTrad('common.loadingSessions') })}</Loader>
          </Box>
        </LoadingOverlay>
      </Container>
    );
  }
  
  return (
    <Container paddingBottom={10}>
      {/* Statistik Cards */}
      <StatsGrid>
        {statCards.map((stat, index) => {
          const IconComponent = stat.icon;
          return (
            <StatCard 
              key={index}
              $color={stat.color}
              $delay={stat.delay}
            >
              <Flex direction="column" alignItems="center">
                <StatIcon 
                  className="stat-icon"
                  $bg={stat.bg}
                  $color={stat.color}
                >
                  <IconComponent />
                </StatIcon>
                <StatValue>
                  {stat.value}
                </StatValue>
                <StatLabel>{stat.title}</StatLabel>
              </Flex>
            </StatCard>
          );
        })}
      </StatsGrid>
      
      {/* Filter Bar */}
      <FilterBar gap={3} alignItems="center">
        <Box flex="1">
          <Searchbar
            name="session-search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={formatMessage({ id: getTrad('common.searchPlaceholder') })}
            clearLabel={formatMessage({ id: getTrad('common.clearLabel') })}
            onClear={() => setSearchQuery('')}
          />
        </Box>
        <SingleSelect
          value={filterStatus}
          onChange={setFilterStatus}
          placeholder={formatMessage({ id: getTrad('tokens.filter.status') })}
        >
          <SingleSelectOption value="all">{formatMessage({ id: getTrad('jwt.filter.all') })}</SingleSelectOption>
          <SingleSelectOption value="active">{formatMessage({ id: getTrad('jwt.filter.active') })}</SingleSelectOption>
          <SingleSelectOption value="expired">{formatMessage({ id: getTrad('jwt.filter.expired') })}</SingleSelectOption>
          <SingleSelectOption value="revoked">{formatMessage({ id: getTrad('jwt.filter.revoked') })}</SingleSelectOption>
        </SingleSelect>
        <SingleSelect
          value={pageSize.toString()}
          onChange={(value) => setPageSize(parseInt(value))}
          placeholder={formatMessage({ id: getTrad('common.entriesPerPage') })}
        >
          <SingleSelectOption value="10">{formatMessage({ id: getTrad('common.entries') }, { count: 10 })}</SingleSelectOption>
          <SingleSelectOption value="25">{formatMessage({ id: getTrad('common.entries') }, { count: 25 })}</SingleSelectOption>
          <SingleSelectOption value="50">{formatMessage({ id: getTrad('common.entries') }, { count: 50 })}</SingleSelectOption>
          <SingleSelectOption value="100">{formatMessage({ id: getTrad('common.entries') }, { count: 100 })}</SingleSelectOption>
        </SingleSelect>
        <Button
          onClick={handleCleanup}
          startIcon={<Trash />}
          variant="secondary"
          size="S"
        >
          {formatMessage({ id: getTrad('jwt.actions.cleanup') })}
        </Button>
        <Button
          onClick={handleRefresh}
          startIcon={<ArrowClockwise />}
          variant="secondary"
          size="S"
        >
          {formatMessage({ id: getTrad('jwt.actions.refresh') })}
        </Button>
      </FilterBar>
      
      {/* Action Bar für Bulk Actions */}
      {selectedSessions.length > 0 && (
        <ActionBar justifyContent="space-between" alignItems="center">
          <Typography fontWeight="semiBold">
            {formatMessage({ id: getTrad('common.selectedSessions') }, { count: selectedSessions.length })}
          </Typography>
          <Button
            onClick={() => setSelectedSessions([])}
            variant="tertiary"
            size="S"
          >
            {formatMessage({ id: getTrad('common.clearSelection') })}
          </Button>
        </ActionBar>
      )}
      
      {/* Data Table */}
      <DataTable>
        {filteredAndSortedSessions.length === 0 ? (
          <EmptyState>
            <Flex direction="column" alignItems="center" gap={6}>
              <Box
                style={{
                  width: '120px',
                  height: '120px',
                  borderRadius: '50%',
                  background: `linear-gradient(135deg, ${theme.colors.primary[100]} 0%, ${theme.colors.primary[200]} 100%)`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: theme.shadows.xl,
                }}
              >
                <Shield style={{ width: '60px', height: '60px', color: theme.colors.primary[600] }} />
              </Box>
              
              <Typography 
                variant="alpha" 
                style={{ 
                  fontSize: '1.75rem',
                  fontWeight: '700',
                  color: theme.colors.neutral[800],
                  marginBottom: '8px',
                }}
              >
                {formatMessage({ id: getTrad('jwt.empty.title') })}
              </Typography>
              
              <Typography 
                variant="omega" 
                textColor="neutral600"
                style={{
                  fontSize: '1rem',
                  maxWidth: '400px',
                  lineHeight: '1.6',
                }}
              >
                {formatMessage({ id: getTrad('jwt.empty.description') })}
              </Typography>
              
              <Flex gap={3} justifyContent="center" style={{ marginTop: '16px' }}>
                <Button
                  onClick={() => {
                    setSearchQuery('');
                    setFilterStatus('all');
                  }}
                  variant="secondary"
                  size="L"
                >
                  {formatMessage({ id: getTrad('jwt.empty.resetFilters') })}
                </Button>
              </Flex>
            </Flex>
          </EmptyState>
        ) : (
          <>
            <StyledTable>
              <Thead>
                <Tr>
                  <Th>
                    <Checkbox
                      checked={selectedSessions.length === paginatedSessions.length && paginatedSessions.length > 0}
                      onCheckedChange={handleSelectAll}
                    />
                  </Th>
                  <Th action={<IconButton label={formatMessage({ id: getTrad('common.tableHeaders.sortByUser') })} onClick={() => handleSort('username')} variant="ghost" withTooltip={false}><CaretDown /></IconButton>}>
                    {formatMessage({ id: getTrad('common.user') })}
                  </Th>
                  <Th>{formatMessage({ id: getTrad('common.tableHeaders.ipAddress') })}</Th>
                  <Th>{formatMessage({ id: getTrad('common.userAgent') })}</Th>
                  <Th action={<IconButton label={formatMessage({ id: getTrad('common.tableHeaders.sortByStatus') })} onClick={() => handleSort('revoked')} variant="ghost" withTooltip={false}><CaretDown /></IconButton>}>
                    {formatMessage({ id: getTrad('common.status') })}
                  </Th>
                  <Th action={<IconButton label={formatMessage({ id: getTrad('common.tableHeaders.sortByCreated') })} onClick={() => handleSort('createdAt')} variant="ghost" withTooltip={false}><CaretDown /></IconButton>}>
                    {formatMessage({ id: getTrad('common.created') })}
                  </Th>
                  <Th action={<IconButton label={formatMessage({ id: getTrad('common.tableHeaders.sortByExpiry') })} onClick={() => handleSort('expiresAt')} variant="ghost" withTooltip={false}><CaretDown /></IconButton>}>
                    {formatMessage({ id: getTrad('common.expiresAt') })}
                  </Th>
                  <Th>{formatMessage({ id: getTrad('common.actions') })}</Th>
                </Tr>
              </Thead>
              <Tbody>
                {paginatedSessions.map((session) => (
                  <Tr key={session.id}>
                    <Td>
                      <Checkbox
                        checked={selectedSessions.includes(session.id)}
                        onCheckedChange={(checked) => handleSelectSession(session.id, checked)}
                      />
                    </Td>
                    <Td>
                      <Flex alignItems="center" gap={2}>
                        <Box
                          style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: theme.borderRadius.full,
                            background: `linear-gradient(135deg, ${theme.colors.primary[500]} 0%, ${theme.colors.primary[600]} 100%)`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          <User style={{ width: '18px', height: '18px', color: 'white' }} />
                        </Box>
                        <Flex direction="column" alignItems="flex-start" gap={0}>
                          <Typography fontWeight="semiBold" ellipsis>
                            {session.username || 'N/A'}
                          </Typography>
                          <Typography variant="omega" textColor="neutral600">
                            {session.email}
                          </Typography>
                        </Flex>
                      </Flex>
                    </Td>
                    <Td>
                      <Typography variant="pi" textColor="neutral600">
                        {session.ipAddress || 'Unbekannt'}
                      </Typography>
                    </Td>
                    <Td>
                      <Flex alignItems="center" gap={1}>
                        <Monitor style={{ width: '14px', height: '14px', color: theme.colors.neutral[500] }} />
                        <Typography 
                          variant="pi" 
                          textColor="neutral600"
                          ellipsis
                          style={{ maxWidth: '200px' }}
                          title={session.userAgent}
                        >
                          {session.userAgent || 'Unbekannt'}
                        </Typography>
                      </Flex>
                    </Td>
                    <Td>
                      {getStatusBadge(session)}
                    </Td>
                    <Td data-label="Created">
                      <Flex alignItems="center" gap={1}>
                        <Calendar style={{ width: '14px', height: '14px', color: theme.colors.neutral[500] }} />
                        <Typography variant="pi">
                          {formatDate(session.createdAt)}
                        </Typography>
                      </Flex>
                    </Td>
                    <Td data-label="Expires">
                      <Flex alignItems="center" gap={1}>
                        <Clock style={{ width: '14px', height: '14px', color: theme.colors.warning[500] }} />
                        <Typography 
                          variant="pi" 
                          textColor={session.isExpired ? 'danger600' : 'neutral800'}
                          fontWeight={session.isExpired ? 'semiBold' : 'normal'}
                        >
                          {formatDate(session.expiresAt)}
                          {session.isExpired && ' (Abgelaufen)'}
                        </Typography>
                      </Flex>
                    </Td>
                    <Td>
                      <Flex gap={1} justifyContent="flex-end">
                        {session.revoked ? (
                          <IconButton
                            label={formatMessage({ id: getTrad('jwt.actions.unrevoke') })}
                            variant="success-ghost"
                            onClick={() => handleUnrevoke(session.id, session.userId)}
                            withTooltip={false}
                            disabled={session.isExpired}
                          >
                            <Check />
                          </IconButton>
                        ) : (
                          <IconButton
                            label={formatMessage({ id: getTrad('jwt.actions.revoke') })}
                            variant="danger-ghost"
                            onClick={() => handleRevoke(session.id)}
                            withTooltip={false}
                          >
                            <Lock />
                          </IconButton>
                        )}
                      </Flex>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </StyledTable>
            
            {/* Pagination */}
            {totalPages > 1 && (
              <Box paddingTop={4} paddingBottom={4}>
                <Flex justifyContent="center">
                  <Pagination activePage={currentPage} pageCount={totalPages}>
                    <PreviousLink onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}>
                      {formatMessage({ id: getTrad('common.previous') })}
                    </PreviousLink>
                    {[...Array(totalPages)].map((_, i) => (
                      <PageLink
                        key={i + 1}
                        number={i + 1}
                        onClick={() => setCurrentPage(i + 1)}
                      >
                        {i + 1}
                      </PageLink>
                    ))}
                    <NextLink onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}>
                      {formatMessage({ id: getTrad('common.next') })}
                    </NextLink>
                  </Pagination>
                </Flex>
              </Box>
            )}
          </>
        )}
      </DataTable>
    </Container>
  );
};

export default JWTSessions;

