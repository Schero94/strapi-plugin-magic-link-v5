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
  Pagination,
  PreviousLink,
  PageLink,
  NextLink,
  IconButton,
  TextInput,
} from '@strapi/design-system';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import {
  ArrowClockwise,
  Earth,
  Trash,
  Lock,
  Check,
  Cross,
  Plus,
  WarningCircle,
} from '@strapi/icons';
import getTrad from '../../utils/getTrad';
import { normalizeIpAddress } from '../../utils/ipAddress.mjs';

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
    display: flex !important;
    flex-direction: column !important;
    align-items: center !important;
    gap: 12px !important;
    max-width: 100% !important;
    margin-bottom: 24px !important;
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
  max-width: 300px;
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
    min-width: 250px !important;
    max-width: 300px !important;
    width: auto !important;
    padding: 20px !important;
    
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
      background: ${props => props.theme.colors.danger100};
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
    content: '🛡️';
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

const LoadingOverlay = styled(Flex)`
  min-height: 400px;
  justify-content: center;
  align-items: center;
  
  .loader-icon {
    animation: ${rotate} 1s linear infinite;
  }
`;

// ================ HAUPTKOMPONENTE ================
const IPBans = () => {
  const { formatMessage } = useIntl();
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  
  // States
  const [bannedIPs, setBannedIPs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newIP, setNewIP] = useState('');
  
  // Stats berechnen
  const stats = useMemo(() => ({
    total: bannedIPs.length,
  }), [bannedIPs]);
  
  // Gefilterte IPs
  const filteredIPs = useMemo(() => {
    let filtered = bannedIPs;
    
    if (searchQuery) {
      filtered = filtered.filter(ip =>
        ip.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    
    return filtered;
  }, [bannedIPs, searchQuery]);
  
  // Pagination
  const paginatedIPs = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    return filteredIPs.slice(start, end);
  }, [filteredIPs, currentPage, pageSize]);
  
  const totalPages = Math.ceil(filteredIPs.length / pageSize);
  const normalizedNewIP = normalizeIpAddress(newIP);
  
  // Stat Cards Konfiguration
  const statCards = [
    {
      title: formatMessage({ id: getTrad('ipban.stats.total') }),
      value: stats.total,
      icon: Lock,
      color: theme.colors.danger[600],
      bg: theme.colors.danger[100],
      delay: '0s'
    },
  ];
  
  // Fetch Functions
  const fetchBannedIPs = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await get('/magic-link/banned-ips');
      setBannedIPs(response?.data?.ips || []);
    } catch (error) {
      console.error('Error fetching banned IPs:', error);
      toggleNotification({
        type: 'warning',
        message: 'Fehler beim Laden der gesperrten IPs',
        title: 'Fehler'
      });
    } finally {
      setIsLoading(false);
    }
  }, [get, toggleNotification]);
  
  useEffect(() => {
    fetchBannedIPs();
  }, [fetchBannedIPs]);
  
  // Handlers
  const handleRefresh = () => {
    fetchBannedIPs();
    toggleNotification({
      type: 'success',
      message: formatMessage({ id: getTrad('ipban.notifications.refreshSuccess') }),
      title: formatMessage({ id: getTrad('tokens.notifications.success') })
    });
  };
  
  const handleBanIP = async () => {
    if (!normalizedNewIP) {
      toggleNotification({
        type: 'warning',
        message: formatMessage({ id: getTrad('ipban.modal.invalidIP') }),
        title: formatMessage({ id: getTrad('tokens.notifications.validation') })
      });
      return;
    }
    
    try {
      await post('/magic-link/ban-ip', {
        data: { ip: normalizedNewIP }
      });
      await fetchBannedIPs();
      setShowAddModal(false);
      setNewIP('');
      toggleNotification({
        type: 'success',
        message: formatMessage({ id: getTrad('ipban.notifications.banSuccess') }, { ip: normalizedNewIP }),
        title: formatMessage({ id: getTrad('tokens.notifications.success') })
      });
    } catch (error) {
      toggleNotification({
        type: 'warning',
        message: formatMessage({ id: getTrad('ipban.notifications.banError') }),
        title: formatMessage({ id: getTrad('tokens.notifications.error') })
      });
    }
  };
  
  const handleUnbanIP = async (ip) => {
    try {
      await post('/magic-link/unban-ip', {
        data: { ip }
      });
      await fetchBannedIPs();
      toggleNotification({
        type: 'success',
        message: formatMessage({ id: getTrad('ipban.notifications.unbanSuccess') }, { ip }),
        title: formatMessage({ id: getTrad('tokens.notifications.success') })
      });
    } catch (error) {
      toggleNotification({
        type: 'warning',
        message: formatMessage({ id: getTrad('ipban.notifications.unbanError') }),
        title: formatMessage({ id: getTrad('tokens.notifications.error') })
      });
    }
  };
  
  // Loading State
  if (isLoading) {
    return (
      <Container>
        <LoadingOverlay>
          <Box className="loader-icon">
            <Loader>{formatMessage({ id: getTrad('common.loadingBannedIPs') })}</Loader>
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
            name="ip-search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={formatMessage({ id: getTrad('common.searchIPPlaceholder') })}
            clearLabel={formatMessage({ id: getTrad('common.clearLabel') })}
            onClear={() => setSearchQuery('')}
          />
        </Box>
        <Button
          onClick={() => setShowAddModal(true)}
          startIcon={<Plus />}
          variant="default"
          size="S"
        >
          {formatMessage({ id: getTrad('ipban.actions.ban') })}
        </Button>
        <Button
          onClick={handleRefresh}
          startIcon={<ArrowClockwise />}
          variant="secondary"
          size="S"
        >
          {formatMessage({ id: getTrad('ipban.actions.refresh') })}
        </Button>
      </FilterBar>
      
      {/* Data Table */}
      <DataTable>
        {filteredIPs.length === 0 ? (
          <EmptyState>
            <Flex direction="column" alignItems="center" gap={6}>
              <Box
                style={{
                  width: '120px',
                  height: '120px',
                  borderRadius: '50%',
                  background: `linear-gradient(135deg, ${theme.colors.success[100]} 0%, ${theme.colors.success[200]} 100%)`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: theme.shadows.xl,
                }}
              >
                <Earth style={{ width: '60px', height: '60px', color: theme.colors.success[600] }} />
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
                {formatMessage({ id: getTrad('ipban.empty.title') })}
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
                {formatMessage({ id: getTrad('ipban.empty.description') })}
              </Typography>
              
              <Flex gap={3} justifyContent="center" style={{ marginTop: '16px' }}>
                <Button
                  onClick={() => setShowAddModal(true)}
                  startIcon={<Plus />}
                  size="L"
                  style={{
                    background: `linear-gradient(135deg, ${theme.colors.danger[600]} 0%, ${theme.colors.danger[700]} 100%)`,
                    color: 'white',
                    border: 'none',
                    fontWeight: '600',
                  }}
                >
                  {formatMessage({ id: getTrad('ipban.empty.action') })}
                </Button>
              </Flex>
            </Flex>
          </EmptyState>
        ) : (
          <>
            <StyledTable>
              <Thead>
                <Tr>
                  <Th>{formatMessage({ id: getTrad('common.tableHeaders.ipAddress') })}</Th>
                  <Th>{formatMessage({ id: getTrad('common.status') })}</Th>
                  <Th>{formatMessage({ id: getTrad('common.actions') })}</Th>
                </Tr>
              </Thead>
              <Tbody>
                {paginatedIPs.map((ip, index) => (
                  <Tr key={index}>
                    <Td>
                      <Flex alignItems="center" gap={2}>
                        <Box
                          style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: theme.borderRadius.full,
                            background: `linear-gradient(135deg, ${theme.colors.danger[500]} 0%, ${theme.colors.danger[600]} 100%)`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          <Lock style={{ width: '18px', height: '18px', color: 'white' }} />
                        </Box>
                        <Typography 
                          fontWeight="semiBold"
                          style={{ 
                            fontFamily: 'monospace',
                            fontSize: '14px',
                          }}
                        >
                          {ip}
                        </Typography>
                      </Flex>
                    </Td>
                    <Td>
                      <AnimatedBadge variant="danger">{formatMessage({ id: getTrad('ipban.status.banned') })}</AnimatedBadge>
                    </Td>
                    <Td>
                      <Flex gap={1} justifyContent="flex-end">
                        <IconButton
                          label={formatMessage({ id: getTrad('ipban.actions.unban') })}
                          variant="success-ghost"
                          onClick={() => handleUnbanIP(ip)}
                          withTooltip={false}
                        >
                          <Check />
                        </IconButton>
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
      
      {/* Add IP Modal */}
      {showAddModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(4, 28, 47, 0.45)',
            backdropFilter: 'blur(3px)',
            zIndex: 999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
          onClick={() => setShowAddModal(false)}
        >
          <Box
            background="neutral0"
            shadow="filterShadow"
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: '480px',
              borderRadius: '8px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <Flex
              justifyContent="space-between"
              alignItems="flex-start"
              paddingTop={6}
              paddingBottom={6}
              paddingLeft={6}
              paddingRight={5}
              style={{
                borderBottom: '1px solid #E9E9F0',
              }}
            >
              <Flex direction="column" gap={1} alignItems="flex-start">
                <Typography variant="beta" style={{ fontSize: '16px', fontWeight: '600' }}>
                  {formatMessage({ id: getTrad('ipban.modal.title') })}
                </Typography>
                <Typography variant="pi" textColor="neutral600" style={{ fontSize: '13px' }}>
                  {formatMessage({ id: getTrad('ipban.modal.subtitle') })}
                </Typography>
              </Flex>
              <IconButton
                onClick={() => setShowAddModal(false)}
                label={formatMessage({ id: getTrad('common.close') })}
                withTooltip={false}
              >
                <Cross />
              </IconButton>
            </Flex>

            {/* Body */}
            <Box paddingTop={6} paddingBottom={6} paddingLeft={6} paddingRight={6}>
              <Flex direction="column" gap={4}>
                <Box
                  padding={3}
                  background="warning100"
                  style={{ 
                    borderRadius: '6px',
                    border: '1px solid #FEF3C7',
                  }}
                >
                  <Flex gap={2} alignItems="flex-start">
                    <WarningCircle style={{ width: '20px', height: '20px', color: theme.colors.warning[600], flexShrink: 0 }} />
                    <Typography variant="pi" style={{ fontSize: '12px', lineHeight: '1.5' }}>
                      {formatMessage({ id: getTrad('ipban.modal.warning') })}
                    </Typography>
                  </Flex>
                </Box>
                
                <Box>
                  <TextInput
                    label={formatMessage({ id: getTrad('ipban.modal.label') })}
                    placeholder={formatMessage({ id: getTrad('ipban.modal.placeholder') })}
                    value={newIP}
                    onChange={(e) => setNewIP(e.target.value)}
                    style={{ fontSize: '14px', fontFamily: 'monospace' }}
                  />
                  <Typography
                    variant="pi" 
                    textColor={newIP && !normalizedNewIP ? 'danger600' : 'neutral600'}
                    style={{ marginTop: '6px', fontSize: '12px' }}
                  >
                    {formatMessage({
                      id: getTrad(newIP && !normalizedNewIP ? 'ipban.modal.invalidIP' : 'ipban.modal.hint'),
                    })}
                  </Typography>
                </Box>
              </Flex>
            </Box>

            {/* Footer */}
            <Box
              paddingTop={5}
              paddingBottom={5}
              paddingLeft={6}
              paddingRight={6}
              style={{
                borderTop: '1px solid #E9E9F0',
                background: '#fafafa',
                borderBottomLeftRadius: '8px',
                borderBottomRightRadius: '8px',
              }}
            >
              <Flex justifyContent="flex-end" gap={3}>
                <Button 
                  onClick={() => {
                    setShowAddModal(false);
                    setNewIP('');
                  }}
                  size="M"
                  variant="tertiary"
                >
                  {formatMessage({ id: getTrad('ipban.modal.cancel') })}
                </Button>
                <Button 
                  onClick={handleBanIP}
                  size="M"
                  variant="danger"
                  startIcon={<Lock />}
                  disabled={!normalizedNewIP}
                >
                  {formatMessage({ id: getTrad('ipban.modal.submit') })}
                </Button>
              </Flex>
            </Box>
          </Box>
        </div>
      )}
    </Container>
  );
};

export default IPBans;

