import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import styled, { keyframes, css } from 'styled-components';
import { useIntl } from 'react-intl';
import CreateTokenModal from './CreateTokenModal';
import ExtendTokenModal from './ExtendTokenModal';
import JWTSessions from './JWTSessions';
import IPBans from './IPBans';
import OTPCodes from './OTPCodes';
import { 
  Main, 
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
  Grid,
  VisuallyHidden,
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
  Plus, 
  Key, 
  Shield, 
  Earth,
  ChartBubble,
  Server,
  Clock,
  Eye,
  Trash,
  Mail,
  Cross,
  WarningCircle,
  Check,
  User,
  Calendar,
  Lock,
  ArrowClockwise,
  Download,
  Duplicate,
  Link,
  Sparkle,
  CaretDown,
  Cog,
} from '@strapi/icons';
import getTrad from '../../utils/getTrad';
import { usePluginLanguage } from '../../components/LanguageProvider';

// ================ DESIGN TOKENS ================
const theme = {
  colors: {
    primary: {
      50: '#F0F9FF',
      100: '#E0F2FE',
      200: '#BAE6FD',
      300: '#7DD3FC',
      400: '#38BDF8',
      500: '#0EA5E9',
      600: '#0284C7',
      700: '#0369A1',
      800: '#075985',
      900: '#0C4A6E',
    },
    secondary: {
      50: '#FAF5FF',
      100: '#F3E8FF',
      200: '#E9D5FF',
      300: '#D8B4FE',
      400: '#C084FC',
      500: '#A855F7',
      600: '#9333EA',
      700: '#7E22CE',
      800: '#6B21A8',
      900: '#581C87',
    },
    success: {
      50: '#F0FDF4',
      100: '#DCFCE7',
      200: '#BBF7D0',
      300: '#86EFAC',
      400: '#4ADE80',
      500: '#22C55E',
      600: '#16A34A',
      700: '#15803D',
      800: '#166534',
      900: '#14532D',
    },
    warning: {
      50: '#FFFBEB',
      100: '#FEF3C7',
      200: '#FDE68A',
      300: '#FCD34D',
      400: '#FBBF24',
      500: '#F59E0B',
      600: '#D97706',
      700: '#B45309',
      800: '#92400E',
      900: '#78350F',
    },
    danger: {
      50: '#FEF2F2',
      100: '#FEE2E2',
      200: '#FECACA',
      300: '#FCA5A5',
      400: '#F87171',
      500: '#EF4444',
      600: '#DC2626',
      700: '#B91C1C',
      800: '#991B1B',
      900: '#7F1D1D',
    },
    neutral: {
      0: '#FFFFFF',
      50: '#F9FAFB',
      100: '#F3F4F6',
      200: '#E5E7EB',
      300: '#D1D5DB',
      400: '#9CA3AF',
      500: '#6B7280',
      600: '#4B5563',
      700: '#374151',
      800: '#1F2937',
      900: '#111827',
      1000: '#030712',
    }
  },
  shadows: {
    xs: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
    sm: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)',
    md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
    xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
    '2xl': '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    inner: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.05)',
  },
  transitions: {
    fast: '150ms cubic-bezier(0.4, 0, 0.2, 1)',
    normal: '300ms cubic-bezier(0.4, 0, 0.2, 1)',
    slow: '500ms cubic-bezier(0.4, 0, 0.2, 1)',
  },
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '16px',
    lg: '24px',
    xl: '32px',
    '2xl': '48px',
    '3xl': '64px',
  },
  borderRadius: {
    sm: '6px',
    md: '8px',
    lg: '12px',
    xl: '16px',
    '2xl': '24px',
    full: '9999px',
  }
};

// ================ ANIMATIONEN ================
const fadeIn = keyframes`
  from { 
    opacity: 0; 
    transform: translateY(10px); 
  }
  to { 
    opacity: 1; 
    transform: translateY(0); 
  }
`;

const slideIn = keyframes`
  from {
    opacity: 0;
    transform: translateX(-10px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
`;

const slideInFromRight = keyframes`
  from {
    opacity: 0;
    transform: translateX(30px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
`;

const slideInFromLeft = keyframes`
  from {
    opacity: 0;
    transform: translateX(-30px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
`;

const slideInContent = keyframes`
  from {
    opacity: 0;
    transform: translateY(20px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
`;

const pulse = keyframes`
  0%, 100% { 
    transform: scale(1);
    opacity: 1;
  }
  50% { 
    transform: scale(0.95);
    opacity: 0.85;
  }
`;

const shimmer = keyframes`
  0% { 
    background-position: -200% 0; 
  }
  100% { 
    background-position: 200% 0; 
  }
`;

const rotate = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

const float = keyframes`
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-5px); }
`;

// ================ RESPONSIVE BREAKPOINTS ================
const breakpoints = {
  mobile: '768px',
  tablet: '1024px',
};

// ================ STYLED COMPONENTS ================
const Container = styled(Box)`
  animation: ${fadeIn} ${theme.transitions.slow};
  min-height: 100vh;
  max-width: 1440px;
  margin: 0 auto;
  padding: ${theme.spacing.xl} ${theme.spacing.lg} 0;
  background: transparent;

  @media (max-width: ${breakpoints.mobile}) {
    padding: ${theme.spacing.md} ${theme.spacing.sm} 0;
  }
`;

const Header = styled(Box)`
  background: linear-gradient(135deg, 
    ${theme.colors.primary[600]} 0%, 
    ${theme.colors.secondary[600]} 100%
  );

  @media (max-width: ${breakpoints.mobile}) {
    padding: ${theme.spacing.lg} ${theme.spacing.md} !important;
    border-radius: ${theme.borderRadius.md} !important;
  }
  border-radius: ${theme.borderRadius.xl};
  padding: ${theme.spacing.xl} ${theme.spacing['2xl']};
  margin-bottom: ${theme.spacing.xl};
  position: relative;
  overflow: hidden;
  box-shadow: ${theme.shadows.xl};
  
  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 200%;
    height: 100%;
    background: linear-gradient(
      90deg, 
      transparent, 
      rgba(255, 255, 255, 0.1), 
      transparent
    );
    animation: ${shimmer} 3s infinite;
  }
  
  &::after {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    width: 100%;
    height: 100%;
    background-image: radial-gradient(circle at 20% 80%, transparent 50%, rgba(255, 255, 255, 0.1) 50%);
    background-size: 15px 15px;
    opacity: 0.3;
  }
`;

const HeaderContent = styled(Flex)`
  position: relative;
  z-index: 1;

  @media (max-width: ${breakpoints.mobile}) {
    flex-direction: column;
    gap: ${theme.spacing.md};
    align-items: stretch !important;
  }
`;

const Title = styled(Typography)`
  color: ${theme.colors.neutral[0]};
  font-size: 2rem;
  font-weight: 700;
  letter-spacing: -0.025em;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  display: flex;
  align-items: center;
  gap: ${theme.spacing.sm};
  
  svg {
    width: 28px;
    height: 28px;
    animation: ${float} 3s ease-in-out infinite;
  }
`;

const Subtitle = styled(Typography)`
  color: rgba(255, 255, 255, 0.9);
  font-size: 0.95rem;
  font-weight: 400;
  margin-top: ${theme.spacing.xs};
  letter-spacing: 0.01em;
`;

const ActionButton = styled(Button)`
  background: rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.3);
  color: white;
  font-weight: 600;
  transition: all ${theme.transitions.normal};
  position: relative;
  overflow: hidden;
  
  &::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 0;
    height: 0;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.3);
    transform: translate(-50%, -50%);
    transition: width ${theme.transitions.slow}, height ${theme.transitions.slow};
  }
  
  &:hover {
    background: rgba(255, 255, 255, 0.3);
    transform: translateY(-2px);
    box-shadow: ${theme.shadows.xl};
    
    &::before {
      width: 300px;
      height: 300px;
    }
  }
  
  &:active {
    transform: translateY(0);
  }

  @media screen and (max-width: 768px) {
    padding: 10px 14px !important;
    font-size: 11px;
    min-width: auto;
    min-height: 48px;
    display: flex !important;
    flex-direction: column !important;
    align-items: center !important;
    justify-content: center !important;
    gap: 4px;
    
    /* Stack icon and text vertically */
    & > span {
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 4px !important;
      margin: 0 !important;
      padding: 0 !important;
    }
    
    /* Style SVG icon */
    svg {
      width: 18px !important;
      height: 18px !important;
      margin: 0 !important;
      display: block !important;
    }
    
    /* Show text label below icon */
    & > span > span:last-child {
      display: block !important;
      font-size: 10px !important;
      line-height: 1.2 !important;
      white-space: nowrap;
    }
  }
`;

const TabsWrapper = styled(Box)`
  position: relative;
  background: linear-gradient(135deg, 
    rgba(79, 70, 229, 0.05) 0%, 
    rgba(147, 51, 234, 0.03) 100%
  );
  border-radius: 16px;
  padding: 6px;
  box-shadow: 
    0 1px 3px rgba(0, 0, 0, 0.06),
    0 1px 2px rgba(0, 0, 0, 0.03),
    inset 0 0 0 1px rgba(255, 255, 255, 0.5);
  margin-bottom: ${theme.spacing.xl};
  max-width: 900px;
  margin-left: auto;
  margin-right: auto;
  backdrop-filter: blur(12px);
  
  &::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 16px;
    padding: 1px;
    background: linear-gradient(135deg, 
      rgba(79, 70, 229, 0.2), 
      rgba(147, 51, 234, 0.2)
    );
    -webkit-mask: 
      linear-gradient(#fff 0 0) content-box, 
      linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    opacity: 0.5;
  }

  @media screen and (max-width: 768px) {
    border-radius: 12px;
    padding: 4px;
    margin: 0 16px 24px 16px;
    max-width: none;
    
    &::before {
      border-radius: 12px;
    }
  }
`;

const TabsContainer = styled.div`
  position: relative;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  
  @media screen and (max-width: 768px) {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    overflow-x: visible;
    padding: 4px;
    width: 100%;
    max-width: 400px;
    margin: 0 auto;

    &::-webkit-scrollbar {
      display: none;
    }
  }
  
  @media screen and (max-width: 400px) {
    gap: 6px;
    max-width: 100%;
  }
`;

const TabIndicator = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: linear-gradient(135deg, 
    ${theme.colors.primary[600]} 0%, 
    ${theme.colors.secondary[600]} 100%
  );
  border-radius: 12px;
  transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow: 
    0 4px 12px rgba(79, 70, 229, 0.3),
    0 2px 6px rgba(79, 70, 229, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
  z-index: 0;
  
  &::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 12px;
    background: linear-gradient(135deg, 
      rgba(255, 255, 255, 0.2) 0%, 
      rgba(255, 255, 255, 0) 100%
    );
  }
  
  @media screen and (max-width: 768px) {
    display: none;
  }
`;

const TabButton = styled(Button)`
  position: relative;
  z-index: 1;
  border-radius: 12px;
  font-weight: 600;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  background: transparent;
  border: none;
  padding: 14px 24px;
  white-space: nowrap;
  
  /* Short label hidden on desktop */
  .tab-label-short {
    display: none;
  }
  
  .tab-label-full {
    display: inline;
  }
  
  ${props => props.$active ? css`
    color: white;
    transform: scale(1.02);
    
    svg {
      filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.15));
    }
    
    &:hover {
      color: white;
      transform: scale(1.02);
    }
  ` : css`
    color: ${theme.colors.neutral[700]};
    
    &:hover {
      color: ${theme.colors.neutral[900]};
      background: rgba(255, 255, 255, 0.5);
      transform: translateY(-1px);
    }
    
    &:active {
      transform: translateY(0);
    }
  `}

  @media screen and (max-width: 768px) {
    padding: 10px 16px !important;
    font-size: 11px;
    border-radius: 12px;
    min-height: 60px;
    min-width: 70px;
    flex: 1;
    max-width: 90px;
    scroll-snap-align: start;
    display: flex !important;
    flex-direction: column !important;
    align-items: center !important;
    justify-content: center !important;
    gap: 6px;
    background: ${props => props.$active 
      ? `linear-gradient(135deg, ${theme.colors.primary[600]} 0%, ${theme.colors.secondary[600]} 100%)`
      : 'rgba(255,255,255,0.9)'};
    color: ${props => props.$active ? theme.colors.neutral[0] : theme.colors.neutral[800]};
    box-shadow: ${props => props.$active 
      ? '0 6px 16px rgba(79, 70, 229, 0.25)'
      : '0 2px 8px rgba(0, 0, 0, 0.06)'};
    
    ${props => props.$active ? css`
      transform: scale(1);
    ` : css`
      &:hover {
        transform: translateY(0);
      }
    `}
    
    /* Show short label, hide full label on mobile */
    .tab-label-full {
      display: none !important;
    }
    
    .tab-label-short {
      display: block !important;
      font-size: 11px !important;
      font-weight: 600;
      line-height: 1.2;
      text-align: center;
    }
    
    /* Stack icon and text vertically */
    & > span {
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 6px !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    /* Style SVG icon */
    svg {
      width: 22px !important;
      height: 22px !important;
      flex-shrink: 0;
      margin: 0 !important;
      display: block !important;
    }
  }
  
  @media screen and (max-width: 480px) {
    padding: 8px 12px !important;
    min-height: 56px;
    min-width: 60px;
    max-width: 80px;
    gap: 4px;
    
    svg {
      width: 20px !important;
      height: 20px !important;
    }
    
    .tab-label-short {
      font-size: 10px !important;
    }
  }
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

  @media (max-width: ${breakpoints.mobile}) {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: ${theme.spacing.sm};
    max-width: 100%;
    margin-bottom: ${theme.spacing.md};
  }
`;

const TabContentWrapper = styled.div`
  animation: ${slideInContent} 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  animation-fill-mode: both;
`;

const StatCard = styled(Box)`
  background: ${props => props.theme.colors.neutral0};
  border-radius: ${theme.borderRadius.lg};
  padding: ${theme.spacing.lg};
  position: relative;
  overflow: hidden;
  transition: all ${theme.transitions.normal};
  animation: ${fadeIn} ${theme.transitions.slow} backwards;
  animation-delay: ${props => props.$delay || '0s'};
  box-shadow: ${theme.shadows.sm};
  border: 1px solid ${props => props.theme.colors.neutral200};
  min-width: 220px;
  max-width: 260px;
  flex: 1;

  @media (max-width: ${breakpoints.mobile}) {
    min-width: unset;
    max-width: unset;
    width: 100%;
    padding: ${theme.spacing.md};
  }
  
  &:hover {
    transform: translateY(-4px);
    box-shadow: ${theme.shadows.xl};
    border-color: ${props => props.$color || theme.colors.primary[500]};
    
    .stat-icon {
      transform: rotate(10deg) scale(1.1);
    }
    
    .stat-value {
      transform: scale(1.05);
    }
  }
  
  &::before {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    width: 120px;
    height: 120px;
    background: radial-gradient(
      circle at center,
      ${props => props.$color || theme.colors.primary[500]}15,
      transparent 70%
    );
    transform: translate(40%, -40%);
  }
`;

const StatIcon = styled(Box)`
  width: 48px;
  height: 48px;
  border-radius: ${theme.borderRadius.md};
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${props => props.$bg || theme.colors.primary[100]};
  transition: all ${theme.transitions.normal};
  
  svg {
    width: 24px;
    height: 24px;
    color: ${props => props.$color || theme.colors.primary[600]};
  }
`;

const StatValue = styled(Typography)`
  font-size: 2rem;
  font-weight: 700;
  color: ${props => props.theme.colors.neutral800};
  line-height: 1;
  margin: ${theme.spacing.sm} 0 ${theme.spacing.xs};
  transition: transform ${theme.transitions.normal};
`;

const StatLabel = styled(Typography)`
  font-size: 0.875rem;
  color: ${props => props.theme.colors.neutral600};
  font-weight: 500;
  letter-spacing: 0.025em;
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
    
    &:last-child {
      border-bottom: none;
    }
    
    &:hover {
      background: ${props => props.theme.colors.primary100};
      
      .action-buttons {
        opacity: 1;
      }
    }
    
    td {
      padding: ${theme.spacing.md};
      color: ${props => props.theme.colors.neutral800};
    }
  }

  /* Mobile Optimization - Card Layout */
  @media screen and (max-width: 768px) {
    display: block !important;
    width: 100% !important;
    
    thead {
      display: none !important;
    }
    
    tbody {
      display: block !important;
      width: 100% !important;
    }
    
    tr {
      display: block !important;
      margin-bottom: 16px !important;
      border: 2px solid #E5E7EB !important;
      border-radius: 12px !important;
      padding: 16px !important;
      background: white !important;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1) !important;
      width: 100% !important;
    }
    
    td {
      display: flex !important;
      justify-content: space-between !important;
      align-items: center !important;
      padding: 8px 0 !important;
      border: none !important;
      width: 100% !important;
      
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
        display: block !important;
        flex-shrink: 0 !important;
      }
      
      /* Hide empty labels */
      &[data-label=""]::before {
        display: none !important;
      }
    }
  }
`;

const StyledBadgeWrapper = styled.span`
  display: inline-block;
  animation: ${slideIn} ${theme.transitions.normal};
  
  &:hover {
    transform: scale(1.05);
  }
`;

const AnimatedBadge = ({ variant, children }) => (
  <StyledBadgeWrapper>
    <Badge variant={variant} style={{ fontWeight: 600, padding: `${theme.spacing.xs} ${theme.spacing.sm}` }}>
      {children}
    </Badge>
  </StyledBadgeWrapper>
);

const EmptyState = styled(Box)`
  background: ${props => props.theme.colors.neutral0};
  border-radius: ${theme.borderRadius.xl};
  padding: ${theme.spacing['3xl']};
  text-align: center;
  border: 2px dashed ${props => props.theme.colors.neutral300};
  position: relative;
  overflow: hidden;
  min-height: 400px;
  display: flex;
  align-items: center;
  justify-content: center;
  
  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(135deg, 
      ${theme.colors.primary[50]} 0%, 
      ${theme.colors.secondary[50]} 100%
    );
    opacity: 0.3;
    z-index: 0;
  }
  
  &::after {
    content: '✨';
    position: absolute;
    bottom: 40px;
    right: 40px;
    font-size: 72px;
    opacity: 0.08;
    animation: ${float} 4s ease-in-out infinite;
  }
  
  > * {
    position: relative;
    z-index: 1;
    width: 100%;
    max-width: 600px;
  }
`;

const LoadingOverlay = styled(Flex)`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(8px);
  z-index: 9999;
  justify-content: center;
  align-items: center;
  
  .loader-icon {
    animation: ${rotate} 1s linear infinite;
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
  animation: ${slideIn} ${theme.transitions.normal};
`;

// ================ HELPER FUNKTIONEN ================
/**
 * Safely parse a date-like value into a valid Date or return null
 * Accepts Date, string, or number. Guards against invalid/undefined values.
 */
const safeDateFrom = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Converts a date-like value to an ISO string or null if invalid.
 */
const toIsoStringOrNull = (value) => {
  const date = safeDateFrom(value);
  return date ? date.toISOString() : null;
};

/**
 * Formats a date-like value to a localized string or fallback dash.
 */
const formatDate = (value) => {
  const date = safeDateFrom(value);
  if (!date) return '—';

  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
};

/**
 * Returns true when the date-like value represents a past moment.
 */
const isDateExpired = (value) => {
  const date = safeDateFrom(value);
  return date ? date.getTime() < Date.now() : false;
};

/**
 * Returns a primitive suitable for sorting (dates -> timestamp).
 */
const toSortableValue = (value) => {
  const asDate = safeDateFrom(value);
  if (asDate) return asDate.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return value.toLowerCase();
  return '';
};

// ================ HAUPTKOMPONENTE ================
const TokensProfessional = () => {
  const navigate = useNavigate();
  const { formatMessage } = useIntl();
  const { get, post, del, put } = useFetchClient();
  const { toggleNotification } = useNotification();
  
  // States
  const [tokens, setTokens] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('magic-links');
  
  // Calculate indicator position for sliding animation
  const getIndicatorStyle = () => {
    const tabWidth = 100 / 4; // 4 tabs = 25% each
    let translateX = 0;
    
    if (activeTab === 'magic-links') translateX = 0;
    else if (activeTab === 'otp-codes') translateX = 1;
    else if (activeTab === 'jwt-sessions') translateX = 2;
    else if (activeTab === 'ip-bans') translateX = 3;
    
    return {
      width: `calc(${tabWidth}% - 4px)`,
      transform: `translateX(calc(${translateX * 100}% + ${translateX * 4}px))`,
    };
  };
  const [selectedTokens, setSelectedTokens] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedTokenDetails, setSelectedTokenDetails] = useState(null);
  const [showExtendModal, setShowExtendModal] = useState(false);
  const [selectedTokenToExtend, setSelectedTokenToExtend] = useState(null);
  const [extendDays, setExtendDays] = useState(7);
  const [showCreatedTokenModal, setShowCreatedTokenModal] = useState(false);
  const [createdTokenData, setCreatedTokenData] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');
  
  // Default TTL from settings (loaded on mount)
  const [defaultTtlHours, setDefaultTtlHours] = useState(24);
  
  // Create Token Form State
  const [newToken, setNewToken] = useState({
    email: '',
    ttl: 24,
    context: {},
    sendEmail: true,
  });
  
  // Stats berechnen
  const stats = useMemo(() => ({
    total: tokens.length,
    active: tokens.filter(t => t.is_active && !isDateExpired(t.expires_at)).length,
    expired: tokens.filter(t => isDateExpired(t.expires_at)).length,
    used: tokens.filter(t => !t.is_active).length,
  }), [tokens]);
  
  // Gefilterte und sortierte Tokens
  const filteredAndSortedTokens = useMemo(() => {
    let filtered = [...tokens];
    
    // Search Filter
    if (searchQuery) {
      filtered = filtered.filter(token => 
        token.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        token.token?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    
    // Status Filter
    if (filterStatus !== 'all') {
      filtered = filtered.filter(token => {
        const isExpired = isDateExpired(token.expires_at);
        switch (filterStatus) {
          case 'active':
            return token.is_active && !isExpired;
          case 'expired':
            return isExpired;
          case 'used':
            return !token.is_active;
          default:
            return true;
        }
      });
    }
    
    // Sortierung
    filtered.sort((a, b) => {
      const aValue = toSortableValue(a[sortBy]);
      const bValue = toSortableValue(b[sortBy]);
      
      if (sortOrder === 'asc') {
        if (aValue === bValue) return 0;
        return aValue > bValue ? 1 : -1;
      } else {
        if (aValue === bValue) return 0;
        return aValue < bValue ? 1 : -1;
      }
    });
    
    return filtered;
  }, [tokens, searchQuery, filterStatus, sortBy, sortOrder]);
  
  // Pagination
  const totalPages = Math.max(0, Math.ceil(filteredAndSortedTokens.length / pageSize));
  const safePageCount = Math.max(1, totalPages);
  const safeCurrentPage = Math.min(Math.max(1, currentPage), safePageCount);

  useEffect(() => {
    if (currentPage !== safeCurrentPage) {
      setCurrentPage(safeCurrentPage);
    }
  }, [currentPage, safeCurrentPage]);

  const paginatedTokens = useMemo(() => {
    const start = (safeCurrentPage - 1) * pageSize;
    const end = start + pageSize;
    return filteredAndSortedTokens.slice(start, end);
  }, [filteredAndSortedTokens, safeCurrentPage, pageSize]);
  
  // Stat Cards Konfiguration
  const statCards = [
    {
      title: formatMessage({ id: getTrad('tokens.stats.total') }),
      value: stats.total,
      icon: Server,
      color: theme.colors.primary[600],
      bg: theme.colors.primary[100],
      delay: '0s'
    },
    {
      title: formatMessage({ id: getTrad('tokens.stats.active') }),
      value: stats.active,
      icon: Sparkle,
      color: theme.colors.success[600],
      bg: theme.colors.success[100],
      delay: '0.1s'
    },
    {
      title: formatMessage({ id: getTrad('tokens.stats.expired') }),
      value: stats.expired,
      icon: Clock,
      color: theme.colors.warning[600],
      bg: theme.colors.warning[100],
      delay: '0.2s'
    },
    {
      title: formatMessage({ id: getTrad('tokens.stats.used') }),
      value: stats.used,
      icon: Check,
      color: theme.colors.secondary[600],
      bg: theme.colors.secondary[100],
      delay: '0.3s'
    }
  ];
  
  // Fetch Functions
  const normalizeToken = (token) => ({
    ...token,
    createdAt: toIsoStringOrNull(token.createdAt || token.created_at),
    expires_at: toIsoStringOrNull(token.expires_at),
    used_at: toIsoStringOrNull(token.used_at),
    last_used_at: toIsoStringOrNull(token.last_used_at),
  });

  const fetchTokens = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await get('/magic-link/tokens');
      const rawTokens = response?.data?.data || response?.data || [];
      setTokens(rawTokens.map(normalizeToken));
    } catch (error) {
      console.error('Error fetching tokens:', error);
      toggleNotification({
        type: 'warning',
        message: formatMessage({ id: getTrad('tokens.notifications.loadError') }),
        title: formatMessage({ id: getTrad('tokens.notifications.error') })
      });
    } finally {
      setIsLoading(false);
    }
  }, [get, toggleNotification]);
  
  useEffect(() => {
    fetchTokens();
    
    /** Loads plugin settings to get expire_period for default TTL */
    const loadDefaultTtl = async () => {
      try {
        const res = await get('/magic-link/settings');
        const settingsData = res?.data?.settings || res?.data?.data || res?.data;
        if (settingsData?.expire_period) {
          const hours = Math.max(1, Math.round(Number(settingsData.expire_period) / 3600));
          setDefaultTtlHours(hours);
          setNewToken(prev => ({ ...prev, ttl: hours }));
        }
      } catch (err) {
        // Fallback to 24h if settings cannot be loaded
        console.error('Error loading settings for default TTL:', err);
      }
    };
    loadDefaultTtl();
  }, [fetchTokens]);
  
  // Handlers
  const handleRefresh = () => {
    fetchTokens();
    toggleNotification({
      type: 'success',
      message: formatMessage({ id: getTrad('tokens.notifications.refreshed') }),
      title: formatMessage({ id: getTrad('tokens.notifications.success') })
    });
  };
  
  const handleDelete = async (tokenId) => {
    try {
      await del(`/magic-link/tokens/${tokenId}`);
      await fetchTokens();
      toggleNotification({
        type: 'success',
        message: formatMessage({ id: getTrad('tokens.notifications.deleted') }),
        title: formatMessage({ id: getTrad('tokens.notifications.success') })
      });
    } catch (error) {
      toggleNotification({
        type: 'warning',
        message: formatMessage({ id: getTrad('tokens.notifications.deleteError') }),
        title: formatMessage({ id: getTrad('tokens.notifications.error') })
      });
    }
  };
  
  const handleBulkDelete = async () => {
    if (selectedTokens.length === 0) return;
    
    try {
      await Promise.all(
        selectedTokens.map(tokenId => del(`/magic-link/tokens/${tokenId}`))
      );
      await fetchTokens();
      setSelectedTokens([]);
      toggleNotification({
        type: 'success',
        message: formatMessage({ id: getTrad('tokens.notifications.bulkDeleted') }, { count: selectedTokens.length }),
        title: formatMessage({ id: getTrad('tokens.notifications.bulkDeleteSuccess') })
      });
    } catch (error) {
      toggleNotification({
        type: 'warning',
        message: formatMessage({ id: getTrad('tokens.notifications.deleteError') }),
        title: formatMessage({ id: getTrad('tokens.notifications.error') })
      });
    }
  };
  
  const handleCreateToken = async () => {
    if (!newToken.email) {
      toggleNotification({
        type: 'warning',
        message: formatMessage({ id: getTrad('tokens.notifications.validationError') }),
        title: formatMessage({ id: getTrad('tokens.notifications.validation') })
      });
      return;
    }
    
    try {
      const response = await post('/magic-link/tokens', {
        email: newToken.email,
        send_email: newToken.sendEmail,
        context: {
          ...newToken.context,
          ttl: newToken.ttl
        }
      });
      
      // Capture the plaintext token from the response!
      const createdToken = response?.data;
      
      await fetchTokens();
      setShowCreateModal(false);
      setNewToken({ email: '', ttl: defaultTtlHours, context: {}, sendEmail: true });
      setSearchQuery(''); // Explizit Suchfeld leeren
      
      // Show the created token modal with plaintext token
      if (createdToken && createdToken.token) {
        setCreatedTokenData({
          token: createdToken.token,
          email: createdToken.email,
          expires_at: createdToken.expires_at,
        });
        setShowCreatedTokenModal(true);
      }
      
      toggleNotification({
        type: 'success',
        message: formatMessage({ id: getTrad('tokens.notifications.created') }, { email: newToken.email }),
        title: formatMessage({ id: getTrad('tokens.notifications.createSuccess') })
      });
    } catch (error) {
      toggleNotification({
        type: 'warning',
        message: formatMessage({ id: getTrad('tokens.notifications.createError') }),
        title: formatMessage({ id: getTrad('tokens.notifications.error') })
      });
    }
  };
  
  const handleExtend = async (tokenId) => {
    try {
      await post(`/magic-link/tokens/${tokenId}/extend`, {
        days: extendDays
      });
      
      await fetchTokens();
      setShowExtendModal(false);
      setSelectedTokenToExtend(null);
      setExtendDays(7); // Reset to default
      
      toggleNotification({
        type: 'success',
        message: formatMessage({ id: getTrad('tokens.notifications.extended') }, { days: extendDays }),
        title: formatMessage({ id: getTrad('tokens.notifications.extendSuccess') })
      });
    } catch (error) {
      toggleNotification({
        type: 'warning',
        message: formatMessage({ id: getTrad('tokens.notifications.extendError') }),
        title: formatMessage({ id: getTrad('tokens.notifications.error') })
      });
    }
  };

  const handleSelectAll = (checked) => {
    if (checked) {
      setSelectedTokens(paginatedTokens.map(token => token.id));
    } else {
      setSelectedTokens([]);
    }
  };
  
  const handleSelectToken = (tokenId, checked) => {
    if (checked) {
      setSelectedTokens([...selectedTokens, tokenId]);
    } else {
      setSelectedTokens(selectedTokens.filter(id => id !== tokenId));
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
  
  const getStatusBadge = (token) => {
    // Prüfe zuerst is_active - wenn false, wurde der Token verwendet oder blockiert
    if (!token.is_active) {
      return <AnimatedBadge variant="secondary">{formatMessage({ id: getTrad('tokens.status.used') })}</AnimatedBadge>;
    }
    // Prüfe ob abgelaufen
    const isExpired = isDateExpired(token.expires_at);
    if (isExpired) {
      return <AnimatedBadge variant="warning">{formatMessage({ id: getTrad('tokens.status.expired') })}</AnimatedBadge>;
    }
    // Token ist aktiv und nicht abgelaufen
    return <AnimatedBadge variant="success">{formatMessage({ id: getTrad('tokens.status.active') })}</AnimatedBadge>;
  };
  
  // Loading State
  if (isLoading) {
    return (
      <LoadingOverlay>
        <Box className="loader-icon">
          <Loader>{formatMessage({ id: getTrad('tokens.loading') })}</Loader>
        </Box>
      </LoadingOverlay>
    );
  }
  
  return (
    <Main>
      <Container paddingBottom={10}>
        {/* Professional Header */}
        <Header>
          <HeaderContent justifyContent="space-between" alignItems="center">
            <Box>
              <Title as="h1">
                <Sparkle /> {formatMessage({ id: getTrad('tokens.page.title') })}
              </Title>
              <Subtitle>
                {formatMessage({ id: getTrad('tokens.page.subtitle') })}
              </Subtitle>
            </Box>
            <Flex gap={2}>
              <ActionButton
                onClick={() => setShowCreateModal(true)}
                startIcon={<Sparkle />}
                size="L"
              >
                {formatMessage({ id: getTrad('tokens.actions.newToken') })}
              </ActionButton>
              <ActionButton
                onClick={handleRefresh}
                startIcon={<ArrowClockwise />}
                size="L"
              >
                {formatMessage({ id: getTrad('tokens.actions.refresh') })}
              </ActionButton>
              <ActionButton
                onClick={() => navigate('/settings/magic-link/config')}
                startIcon={<Cog />}
                size="L"
              >
                {formatMessage({ id: getTrad('tokens.actions.settings') })}
              </ActionButton>
            </Flex>
          </HeaderContent>
        </Header>
        
        {/* Tab Navigation */}
        <TabsWrapper>
          <TabsContainer>
            <TabIndicator style={getIndicatorStyle()} />
            <TabButton
              $active={activeTab === 'magic-links'}
              onClick={() => setActiveTab('magic-links')}
              startIcon={<Key />}
              size="L"
              data-short-label="Links"
            >
              <span className="tab-label-full">{formatMessage({ id: getTrad('tokens.tabs.magicLinks') })}</span>
              <span className="tab-label-short">Links</span>
            </TabButton>
            <TabButton
              $active={activeTab === 'otp-codes'}
              onClick={() => setActiveTab('otp-codes')}
              startIcon={<Lock />}
              size="L"
              data-short-label="OTP"
            >
              <span className="tab-label-full">OTP Codes</span>
              <span className="tab-label-short">OTP</span>
            </TabButton>
            <TabButton
              $active={activeTab === 'jwt-sessions'}
              onClick={() => setActiveTab('jwt-sessions')}
              startIcon={<Shield />}
              size="L"
              data-short-label="JWT"
            >
              <span className="tab-label-full">{formatMessage({ id: getTrad('tokens.tabs.jwtSessions') })}</span>
              <span className="tab-label-short">JWT</span>
            </TabButton>
            <TabButton
              $active={activeTab === 'ip-bans'}
              onClick={() => setActiveTab('ip-bans')}
              startIcon={<Earth />}
              size="L"
              data-short-label="IP"
            >
              <span className="tab-label-full">{formatMessage({ id: getTrad('tokens.tabs.ipBans') })}</span>
              <span className="tab-label-short">IP</span>
            </TabButton>
          </TabsContainer>
        </TabsWrapper>
        
        {/* Statistik Cards */}
        {activeTab === 'magic-links' && (
          <TabContentWrapper key="magic-links-content">
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
                      <StatValue className="stat-value">
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
                key={`searchbar-${tokens.length}`}
                name="token-search"
                id="token-search"
                autoComplete="off"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={formatMessage({ id: getTrad('tokens.search.placeholder') })}
                clearLabel={formatMessage({ id: getTrad('tokens.search.clear') })}
                onClear={() => setSearchQuery('')}
              />
            </Box>
            <SingleSelect
              value={filterStatus}
              onChange={setFilterStatus}
              placeholder={formatMessage({ id: getTrad('tokens.filter.status') })}
            >
              <SingleSelectOption value="all">{formatMessage({ id: getTrad('tokens.filter.all') })}</SingleSelectOption>
              <SingleSelectOption value="active">{formatMessage({ id: getTrad('tokens.filter.active') })}</SingleSelectOption>
              <SingleSelectOption value="expired">{formatMessage({ id: getTrad('tokens.filter.expired') })}</SingleSelectOption>
              <SingleSelectOption value="used">{formatMessage({ id: getTrad('tokens.filter.used') })}</SingleSelectOption>
            </SingleSelect>
            <SingleSelect
              value={pageSize.toString()}
              onChange={(value) => setPageSize(parseInt(value))}
              placeholder={formatMessage({ id: getTrad('tokens.pageSize.label') })}
            >
              <SingleSelectOption value="10">{formatMessage({ id: getTrad('tokens.pageSize.10') })}</SingleSelectOption>
              <SingleSelectOption value="25">{formatMessage({ id: getTrad('tokens.pageSize.25') })}</SingleSelectOption>
              <SingleSelectOption value="50">{formatMessage({ id: getTrad('tokens.pageSize.50') })}</SingleSelectOption>
              <SingleSelectOption value="100">{formatMessage({ id: getTrad('tokens.pageSize.100') })}</SingleSelectOption>
            </SingleSelect>
          </FilterBar>
        
        {/* Action Bar für Bulk Actions */}
        {selectedTokens.length > 0 && (
          <ActionBar justifyContent="space-between" alignItems="center">
            <Typography fontWeight="semiBold">
              {formatMessage({ id: getTrad('tokens.selected') }, { count: selectedTokens.length })}
            </Typography>
            <Flex gap={2}>
              <Button
                onClick={() => setSelectedTokens([])}
                variant="tertiary"
                size="S"
              >
                {formatMessage({ id: getTrad('tokens.actions.clearSelection') })}
              </Button>
              <Button
                onClick={handleBulkDelete}
                startIcon={<Trash />}
                variant="danger"
                size="S"
              >
                {formatMessage({ id: getTrad('tokens.actions.bulkDelete') })}
              </Button>
            </Flex>
          </ActionBar>
        )}
        
        {/* Data Table */}
        <DataTable>
            {filteredAndSortedTokens.length === 0 ? (
              <EmptyState>
                <Flex direction="column" alignItems="center" gap={6}>
                  {/* Icon */}
                  <Box
                    style={{
                      width: '120px',
                      height: '120px',
                      borderRadius: '50%',
                      background: `linear-gradient(135deg, ${theme.colors.primary[100]} 0%, ${theme.colors.secondary[100]} 100%)`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: theme.shadows.xl,
                    }}
                  >
                    <Eye style={{ width: '60px', height: '60px', color: theme.colors.primary[600] }} />
                  </Box>
                  
                  {/* Titel */}
                  <Typography 
                    variant="alpha" 
                    style={{ 
                      fontSize: '1.75rem',
                      fontWeight: '700',
                      color: theme.colors.neutral[800],
                      marginBottom: '8px',
                    }}
                  >
                    {formatMessage({ id: getTrad('tokens.empty.title') })}
                  </Typography>
                  
                  {/* Beschreibung */}
                  <Typography 
                    variant="omega" 
                    textColor="neutral600"
                    style={{
                      fontSize: '1rem',
                      maxWidth: '400px',
                      lineHeight: '1.6',
                    }}
                  >
                    {formatMessage({ id: getTrad('tokens.empty.description') })}
                  </Typography>
                  
                  {/* Aktionen */}
                  <Flex gap={3} justifyContent="center" style={{ marginTop: '16px' }}>
                    <Button
                      onClick={() => setShowCreateModal(true)}
                      startIcon={<Plus />}
                      size="L"
                      style={{
                        background: `linear-gradient(135deg, ${theme.colors.primary[600]} 0%, ${theme.colors.secondary[600]} 100%)`,
                        color: 'white',
                        border: 'none',
                        fontWeight: '600',
                        padding: '12px 24px',
                      }}
                    >
                      {formatMessage({ id: getTrad('tokens.empty.createFirst') })}
                    </Button>
                    <Button
                      onClick={() => {
                        setSearchQuery('');
                        setFilterStatus('all');
                      }}
                      variant="secondary"
                      size="L"
                    >
                      {formatMessage({ id: getTrad('tokens.empty.resetFilters') })}
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
                          checked={selectedTokens.length === paginatedTokens.length && paginatedTokens.length > 0}
                          onCheckedChange={handleSelectAll}
                        />
                      </Th>
                      <Th action={<IconButton label={formatMessage({ id: getTrad('tokens.table.sortBy') })} onClick={() => handleSort('email')} variant="ghost" withTooltip={false}><CaretDown /></IconButton>}>
                        {formatMessage({ id: getTrad('tokens.table.email') })}
                      </Th>
                      <Th>{formatMessage({ id: getTrad('tokens.table.reference') })}</Th>
                      <Th action={<IconButton label={formatMessage({ id: getTrad('tokens.table.sortBy') })} onClick={() => handleSort('status')} variant="ghost" withTooltip={false}><CaretDown /></IconButton>}>
                        {formatMessage({ id: getTrad('tokens.table.status') })}
                      </Th>
                      <Th action={<IconButton label={formatMessage({ id: getTrad('tokens.table.sortBy') })} onClick={() => handleSort('createdAt')} variant="ghost" withTooltip={false}><CaretDown /></IconButton>}>
                        {formatMessage({ id: getTrad('tokens.table.created') })}
                      </Th>
                      <Th action={<IconButton label={formatMessage({ id: getTrad('tokens.table.sortBy') })} onClick={() => handleSort('expires_at')} variant="ghost" withTooltip={false}><CaretDown /></IconButton>}>
                        {formatMessage({ id: getTrad('tokens.table.expiresAt') })}
                      </Th>
                      <Th>
                        <VisuallyHidden>{formatMessage({ id: getTrad('tokens.table.actions') })}</VisuallyHidden>
                      </Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {paginatedTokens.map((token) => (
                      <Tr key={token.id}>
                        <Td data-label="">
                          <Checkbox
                            checked={selectedTokens.includes(token.id)}
                            onCheckedChange={(checked) => handleSelectToken(token.id, checked)}
                          />
                        </Td>
                        <Td data-label={formatMessage({ id: getTrad('tokens.table.email') })}>
                          <Flex alignItems="center" gap={2}>
                            <Box
                              style={{
                                width: '36px',
                                height: '36px',
                                borderRadius: theme.borderRadius.full,
                                background: `linear-gradient(135deg, ${theme.colors.primary[500]} 0%, ${theme.colors.secondary[500]} 100%)`,
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
                                {token.email}
                              </Typography>
                              <Typography variant="omega" textColor="neutral600">
                                {token.user_id ? formatMessage({ id: getTrad('tokens.user.id') }, { id: token.user_id }) : formatMessage({ id: getTrad('tokens.user.new') })}
                              </Typography>
                            </Flex>
                          </Flex>
                        </Td>
                        <Td data-label={formatMessage({ id: getTrad('tokens.table.reference') })}>
                          <Flex direction="column" alignItems="flex-start" gap={1}>
                            <Typography 
                              variant="pi" 
                              fontWeight="semiBold"
                              textColor="neutral800"
                              style={{ 
                                fontFamily: 'monospace', 
                                fontSize: '12px',
                                background: 'rgba(128, 128, 128, 0.15)',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                color: 'var(--colors-neutral800, #32324d)',
                              }}
                            >
                              #{token.documentId ? token.documentId.slice(-8) : token.id}
                            </Typography>
                            {token.is_used && token.used_at && (
                              <Typography variant="omega" textColor="success600" style={{ fontSize: '11px' }}>
                                ✓ {formatMessage({ id: getTrad('tokens.table.usedAt') })}: {formatDate(token.used_at)}
                              </Typography>
                            )}
                            {token.login_ip && (
                              <Typography variant="omega" textColor="neutral500" style={{ fontSize: '10px', fontFamily: 'monospace' }}>
                                IP: {token.login_ip}
                              </Typography>
                            )}
                          </Flex>
                        </Td>
                        <Td data-label={formatMessage({ id: getTrad('tokens.table.status') })}>
                          {getStatusBadge(token)}
                        </Td>
                        <Td data-label={formatMessage({ id: getTrad('tokens.table.created') })}>
                          <Flex alignItems="center" gap={1}>
                            <Calendar style={{ width: '14px', height: '14px', color: theme.colors.neutral[500] }} />
                  <Typography variant="pi">
                    {formatDate(token.createdAt)}
                  </Typography>
                          </Flex>
                        </Td>
                        <Td data-label={formatMessage({ id: getTrad('tokens.table.expiresAt') })}>
                          <Flex alignItems="center" gap={1}>
                            <Clock style={{ width: '14px', height: '14px', color: theme.colors.warning[500] }} />
                            {(() => {
                              const formattedDate = formatDate(token.expires_at);
                              if (formattedDate === '—') {
                                return (
                                  <Typography variant="pi" textColor="success600">
                                    {formatMessage({ id: getTrad('tokens.details.never') })}
                                  </Typography>
                                );
                              }
                          const isExpired = isDateExpired(token.expires_at);
                              return (
                                <Typography 
                                  variant="pi" 
                                  textColor={isExpired ? 'danger600' : 'neutral800'}
                                  fontWeight={isExpired ? 'semiBold' : 'normal'}
                                >
                                  {formattedDate}
                                  {isExpired && formatMessage({ id: getTrad('tokens.details.expiredSuffix') })}
                                </Typography>
                              );
                            })()}
                          </Flex>
                        </Td>
                        <Td data-label={formatMessage({ id: getTrad('tokens.table.actions') })}>
                          <Flex gap={1} justifyContent="flex-end">
                            <IconButton
                              label={formatMessage({ id: getTrad('tokens.actions.viewDetails') })}
                              variant="ghost"
                              onClick={() => {
                                setSelectedTokenDetails(token);
                                setShowDetailsModal(true);
                              }}
                              withTooltip={false}
                            >
                              <Eye />
                            </IconButton>
                            {!token.is_used && token.status !== 'blocked' && (
                              <IconButton
                                label={formatMessage({ id: getTrad('tokens.actions.extend') })}
                                variant="ghost"
                                onClick={() => {
                                  setSelectedTokenToExtend(token);
                                  setShowExtendModal(true);
                                }}
                                withTooltip={false}
                              >
                                <Clock />
                              </IconButton>
                            )}
                            <IconButton
                              label={formatMessage({ id: getTrad('tokens.actions.delete') })}
                              variant="danger-ghost"
                              onClick={() => handleDelete(token.id)}
                              withTooltip={false}
                            >
                              <Trash />
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
                      <Pagination activePage={safeCurrentPage} pageCount={safePageCount}>
                        <PreviousLink onClick={() => setCurrentPage(Math.max(1, safeCurrentPage - 1))}>
                          {formatMessage({ id: getTrad('tokens.pagination.previous') })}
                        </PreviousLink>
                        {[...Array(safePageCount)].map((_, i) => (
                          <PageLink
                            key={i + 1}
                            number={i + 1}
                            onClick={() => setCurrentPage(Math.min(safePageCount, i + 1))}
                          >
                            {i + 1}
                          </PageLink>
                        ))}
                        <NextLink onClick={() => setCurrentPage(Math.min(safePageCount, safeCurrentPage + 1))}>
                          {formatMessage({ id: getTrad('tokens.pagination.next') })}
                        </NextLink>
                      </Pagination>
                    </Flex>
                  </Box>
                )}
              </>
            )}
          </DataTable>
          </TabContentWrapper>
        )}
        
        {/* JWT Sessions Tab */}
        {activeTab === 'jwt-sessions' && (
          <TabContentWrapper key="jwt-sessions-content">
            <JWTSessions />
          </TabContentWrapper>
        )}
        
        {/* IP-Bans Tab */}
        {activeTab === 'ip-bans' && (
          <TabContentWrapper key="ip-bans-content">
            <IPBans />
          </TabContentWrapper>
        )}
        
        {activeTab === 'otp-codes' && (
          <TabContentWrapper key="otp-codes-content">
            <OTPCodes />
          </TabContentWrapper>
        )}
        
        {/* Token Details Modal */}
        {showDetailsModal && selectedTokenDetails && (
          <>
            {/* Backdrop */}
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
              onClick={() => setShowDetailsModal(false)}
            >
              {/* Modal Content */}
              <Box
                background="neutral0"
                shadow="filterShadow"
                style={{
                  position: 'relative',
                  width: '100%',
                  maxWidth: '600px',
                  maxHeight: 'calc(100vh - 40px)',
                  overflow: 'auto',
                  borderRadius: '8px',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <Box
                  padding={6}
                  style={{
                    borderBottom: '1px solid #E9E9F0',
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    position: 'relative',
                  }}
                >
                  <Flex direction="column" alignItems="stretch" gap={2}>
                    <Flex justifyContent="space-between" alignItems="flex-start">
                      <Typography variant="alpha" style={{ 
                        color: 'white', 
                        fontSize: '24px', 
                        fontWeight: '700',
                        letterSpacing: '-0.025em',
                      }}>
                        {formatMessage({ id: getTrad('tokens.details.title') })}
                      </Typography>
                      <IconButton
                        onClick={() => setShowDetailsModal(false)}
                        label={formatMessage({ id: getTrad('tokens.details.close') })}
                        withTooltip={false}
                        style={{
                          background: 'rgba(255,255,255,0.2)',
                          color: 'white',
                        }}
                      >
                        <Cross />
                      </IconButton>
                    </Flex>
                    <Typography variant="epsilon" style={{ 
                      color: 'rgba(255,255,255,0.9)', 
                      fontSize: '16px',
                      fontWeight: '400',
                    }}>
                      {selectedTokenDetails.email}
                    </Typography>
                  </Flex>
                </Box>

                {/* Body */}
                <Box padding={7}>
                  <Flex direction="column" alignItems="stretch" gap={5}>
                    
                    {/* Reference ID */}
                    <Flex alignItems="center" gap={3}>
                      <Typography variant="sigma" fontWeight="semiBold" textColor="neutral600" style={{ fontSize: '12px' }}>
                        {formatMessage({ id: getTrad('tokens.details.reference') })}:
                      </Typography>
                      <Typography 
                        variant="pi" 
                        fontWeight="bold"
                        style={{ 
                          fontFamily: 'monospace', 
                          fontSize: '14px',
                          background: theme.colors.neutral[100],
                          padding: '4px 12px',
                          borderRadius: '6px',
                        }}
                      >
                        #{selectedTokenDetails.documentId ? selectedTokenDetails.documentId.slice(-8) : selectedTokenDetails.id}
                      </Typography>
                    </Flex>

                    {/* Status & Dates Grid */}
                    <Box
                      style={{
                        borderRadius: '12px',
                        border: '1px solid #e0e0e8',
                        overflow: 'hidden',
                      }}
                    >
                      {/* Status Row */}
                      <Flex 
                        alignItems="center" 
                        justifyContent="space-between"
                        style={{
                          padding: '14px 20px',
                          background: '#f8f8fc',
                          borderBottom: '1px solid #e0e0e8',
                        }}
                      >
                        <Typography variant="omega" fontWeight="semiBold" textColor="neutral700" style={{ fontSize: '13px' }}>
                          {formatMessage({ id: getTrad('tokens.details.status') })}
                        </Typography>
                        {getStatusBadge(selectedTokenDetails)}
                      </Flex>
                      
                      {/* Created Date Row */}
                      <Flex 
                        alignItems="center" 
                        justifyContent="space-between"
                        style={{
                          padding: '12px 20px',
                          background: 'white',
                          borderBottom: '1px solid #f0f0f5',
                        }}
                      >
                        <Typography variant="omega" textColor="neutral600" style={{ fontSize: '13px' }}>
                          {formatMessage({ id: getTrad('tokens.details.created') })}
                        </Typography>
                        <Typography variant="pi" style={{ fontSize: '13px', fontWeight: '600', color: '#32324d' }}>
                          {formatDate(selectedTokenDetails.createdAt)}
                        </Typography>
                      </Flex>
                      
                      {/* Expiry Date Row */}
                      <Flex 
                        alignItems="center" 
                        justifyContent="space-between"
                        style={{
                          padding: '12px 20px',
                          background: 'white',
                          borderBottom: selectedTokenDetails.used_at || selectedTokenDetails.last_used_at ? '1px solid #f0f0f5' : 'none',
                        }}
                      >
                        <Typography variant="omega" textColor="neutral600" style={{ fontSize: '13px' }}>
                          {formatMessage({ id: getTrad('tokens.details.expiresAt') })}
                        </Typography>
                        <Typography 
                          variant="pi" 
                          style={{ 
                            fontSize: '13px', 
                            fontWeight: '600',
                              color: isDateExpired(selectedTokenDetails.expires_at) ? '#d02b20' : '#32324d'
                          }}
                        >
                          {formatDate(selectedTokenDetails.expires_at) || formatMessage({ id: getTrad('tokens.details.unlimited') })}
                        </Typography>
                      </Flex>
                      
                      {/* Used Date (if applicable) */}
                      {selectedTokenDetails.used_at && (
                        <Flex 
                          alignItems="center" 
                          justifyContent="space-between"
                          style={{
                            padding: '12px 20px',
                            background: '#f0fdf4',
                            borderBottom: selectedTokenDetails.last_used_at && selectedTokenDetails.last_used_at !== selectedTokenDetails.used_at ? '1px solid #dcfce7' : 'none',
                          }}
                        >
                          <Typography variant="omega" textColor="neutral600" style={{ fontSize: '13px' }}>
                            {formatMessage({ id: getTrad('tokens.details.usedAt') })}
                          </Typography>
                          <Flex alignItems="center" gap={2}>
                            <Box style={{ 
                              width: '8px', 
                              height: '8px', 
                              borderRadius: '50%', 
                              background: '#22c55e' 
                            }} />
                            <Typography variant="pi" style={{ fontSize: '13px', fontWeight: '600', color: '#15803d' }}>
                              {formatDate(selectedTokenDetails.used_at)}
                            </Typography>
                          </Flex>
                        </Flex>
                      )}

                      {/* Last Used At (if different from used_at) */}
                      {selectedTokenDetails.last_used_at && selectedTokenDetails.last_used_at !== selectedTokenDetails.used_at && (
                        <Flex 
                          alignItems="center" 
                          justifyContent="space-between"
                          style={{
                            padding: '12px 20px',
                            background: 'white',
                          }}
                        >
                          <Typography variant="omega" textColor="neutral600" style={{ fontSize: '13px' }}>
                            {formatMessage({ id: getTrad('tokens.details.lastUsedAt') })}
                          </Typography>
                          <Typography variant="pi" style={{ fontSize: '13px', fontWeight: '600', color: '#32324d' }}>
                            {formatDate(selectedTokenDetails.last_used_at)}
                          </Typography>
                        </Flex>
                      )}
                    </Box>

                    {/* Technical Details */}
                    {(selectedTokenDetails.ip_address || selectedTokenDetails.user_agent) && (
                      <Box>
                        <Typography variant="sigma" fontWeight="semiBold" textColor="neutral800" style={{ marginBottom: '8px', textTransform: 'uppercase', fontSize: '11px', letterSpacing: '0.5px' }}>
                          {formatMessage({ id: getTrad('tokens.details.technicalInfo') })}
                        </Typography>
                        <Box
                          padding={4}
                          background="neutral100"
                          style={{
                            borderRadius: '8px',
                            border: '1px solid #e0e0e8',
                          }}
                        >
                          <Flex direction="column" gap={2}>
                            {selectedTokenDetails.ip_address && (
                              <Flex alignItems="center" gap={2}>
                                <Earth style={{ width: '14px', height: '14px', color: theme.colors.neutral[500] }} />
                                <Typography variant="pi" textColor="neutral700" style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                                  {selectedTokenDetails.ip_address}
                                </Typography>
                              </Flex>
                            )}
                            {selectedTokenDetails.user_agent && (
                              <Typography variant="pi" textColor="neutral500" style={{ fontSize: '11px', wordBreak: 'break-all' }}>
                                {selectedTokenDetails.user_agent}
                              </Typography>
                            )}
                          </Flex>
                        </Box>
                      </Box>
                    )}

                    {/* Context Data */}
                    {selectedTokenDetails.context && Object.keys(selectedTokenDetails.context).length > 0 && (
                      <Box>
                        <Typography variant="sigma" fontWeight="semiBold" textColor="neutral800" style={{ marginBottom: '8px', textTransform: 'uppercase', fontSize: '11px', letterSpacing: '0.5px' }}>
                          {formatMessage({ id: getTrad('tokens.details.context') })}
                        </Typography>
                        <Box
                          padding={4}
                          style={{
                            borderRadius: '8px',
                            background: '#1e1e2e',
                            border: '1px solid #313244',
                          }}
                        >
                          <pre style={{ 
                            margin: 0, 
                            fontFamily: 'Monaco, Consolas, monospace', 
                            fontSize: '12px',
                            color: '#cdd6f4',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            lineHeight: '1.6',
                          }}>
                            {JSON.stringify(selectedTokenDetails.context, null, 2)}
                          </pre>
                        </Box>
                      </Box>
                    )}

                    {/* Action Buttons */}
                    <Box style={{ marginTop: '8px' }}>
                      <Typography variant="sigma" fontWeight="semiBold" textColor="neutral800" style={{ marginBottom: '12px', textTransform: 'uppercase', fontSize: '11px', letterSpacing: '0.5px' }}>
                        {formatMessage({ id: getTrad('tokens.details.actions') })}
                      </Typography>
                      <Flex gap={2} wrap="wrap">
                        {/* New Token Button - Create a new token for same email (useful for expired/used/blocked tokens) */}
                        {(selectedTokenDetails.is_used || (selectedTokenDetails.expires_at && new Date(selectedTokenDetails.expires_at) < new Date()) || selectedTokenDetails.status === 'blocked') && (
                          <Button
                            variant="success"
                            size="S"
                            startIcon={<Plus />}
                            onClick={async () => {
                              try {
                                const response = await post('/magic-link/tokens', {
                                  email: selectedTokenDetails.email,
                                  context: selectedTokenDetails.context || {},
                                });
                                const data = response?.data;
                                toggleNotification({
                                  type: 'success',
                                  message: formatMessage({ id: getTrad('tokens.notifications.reactivateSuccess') }),
                                });
                                setShowDetailsModal(false);
                                // Show the new token modal
                                if (data?.token) {
                                  setCreatedTokenData({
                                    token: data.token,
                                    email: selectedTokenDetails.email,
                                  });
                                  setShowCreatedTokenModal(true);
                                }
                                fetchTokens();
                              } catch (error) {
                                toggleNotification({
                                  type: 'warning',
                                  message: formatMessage({ id: getTrad('tokens.notifications.reactivateError') }),
                                });
                              }
                            }}
                          >
                            {formatMessage({ id: getTrad('tokens.actions.reactivate') })}
                          </Button>
                        )}

                        {/* Extend Button - Only for active, unused tokens */}
                        {selectedTokenDetails.is_active && !selectedTokenDetails.is_used && selectedTokenDetails.status !== 'blocked' && (
                          <Button
                            variant="secondary"
                            size="S"
                            startIcon={<Clock />}
                            onClick={() => {
                              setSelectedTokenToExtend(selectedTokenDetails);
                              setShowExtendModal(true);
                              setShowDetailsModal(false);
                            }}
                          >
                            {formatMessage({ id: getTrad('tokens.actions.extend') })}
                          </Button>
                        )}

                        {/* Block/Unblock Button */}
                        {selectedTokenDetails.status !== 'blocked' && !selectedTokenDetails.is_used ? (
                          <Button
                            variant="danger"
                            size="S"
                            startIcon={<Lock />}
                            onClick={async () => {
                              try {
                                await post(`/magic-link/tokens/${selectedTokenDetails.documentId || selectedTokenDetails.id}/block`);
                                toggleNotification({
                                  type: 'success',
                                  message: formatMessage({ id: getTrad('tokens.notifications.blockSuccess') }),
                                });
                                setShowDetailsModal(false);
                                fetchTokens();
                              } catch (error) {
                                toggleNotification({
                                  type: 'warning',
                                  message: formatMessage({ id: getTrad('tokens.notifications.blockError') }),
                                });
                              }
                            }}
                          >
                            {formatMessage({ id: getTrad('tokens.actions.block') })}
                          </Button>
                        ) : selectedTokenDetails.status === 'blocked' && (
                          <Button
                            variant="success"
                            size="S"
                            startIcon={<Check />}
                            onClick={async () => {
                              try {
                                await post(`/magic-link/tokens/${selectedTokenDetails.documentId || selectedTokenDetails.id}/activate`);
                                toggleNotification({
                                  type: 'success',
                                  message: formatMessage({ id: getTrad('tokens.notifications.activateSuccess') }),
                                });
                                setShowDetailsModal(false);
                                fetchTokens();
                              } catch (error) {
                                toggleNotification({
                                  type: 'warning',
                                  message: formatMessage({ id: getTrad('tokens.notifications.error') }),
                                });
                              }
                            }}
                          >
                            {formatMessage({ id: getTrad('tokens.actions.activate') })}
                          </Button>
                        )}

                        {/* Delete Button */}
                        <Button
                          variant="danger-light"
                          size="S"
                          startIcon={<Trash />}
                          onClick={() => {
                            handleDelete(selectedTokenDetails.id);
                            setShowDetailsModal(false);
                          }}
                        >
                          {formatMessage({ id: getTrad('tokens.actions.delete') })}
                        </Button>
                      </Flex>
                    </Box>
                  </Flex>
                </Box>

                {/* Footer */}
                <Box
                  paddingTop={5}
                  paddingBottom={5}
                  paddingLeft={7}
                  paddingRight={7}
                  style={{
                    borderTop: '1px solid #E9E9F0',
                    background: '#fafafa',
                    borderBottomLeftRadius: '8px',
                    borderBottomRightRadius: '8px',
                  }}
                >
                  <Flex justifyContent="flex-end">
                    <Button 
                      onClick={() => setShowDetailsModal(false)}
                      size="M"
                      variant="tertiary"
                    >
                      {formatMessage({ id: getTrad('tokens.details.close') })}
                    </Button>
                  </Flex>
                </Box>
              </Box>
            </div>
          </>
        )}
        
        {/* Token Created Successfully Modal - Shows plaintext token */}
        {showCreatedTokenModal && createdTokenData && (
          <>
            {/* Backdrop */}
            <div
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(4, 28, 47, 0.45)',
                backdropFilter: 'blur(3px)',
                zIndex: 1000,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '20px',
              }}
              onClick={() => setShowCreatedTokenModal(false)}
            >
              {/* Modal Content */}
              <Box
                background="neutral0"
                shadow="filterShadow"
                style={{
                  position: 'relative',
                  width: '100%',
                  maxWidth: '600px',
                  maxHeight: 'calc(100vh - 40px)',
                  overflow: 'auto',
                  borderRadius: '8px',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <Box
                  padding={6}
                  style={{
                    borderBottom: '1px solid #E9E9F0',
                    background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                    position: 'relative',
                  }}
                >
                  <Flex direction="column" alignItems="stretch" gap={2}>
                    <Flex justifyContent="space-between" alignItems="flex-start">
                      <Flex alignItems="center" gap={3}>
                        <Box
                          style={{
                            width: '48px',
                            height: '48px',
                            borderRadius: '50%',
                            background: 'rgba(255,255,255,0.2)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Check style={{ width: '28px', height: '28px', color: 'white' }} />
                        </Box>
                        <Typography variant="alpha" style={{ 
                          color: 'white', 
                          fontSize: '24px', 
                          fontWeight: '700',
                          letterSpacing: '-0.025em',
                        }}>
                          {formatMessage({ id: getTrad('tokens.created.title') })}
                        </Typography>
                      </Flex>
                      <IconButton
                        onClick={() => setShowCreatedTokenModal(false)}
                        label={formatMessage({ id: getTrad('tokens.details.close') })}
                        withTooltip={false}
                        style={{
                          background: 'rgba(255,255,255,0.2)',
                          color: 'white',
                        }}
                      >
                        <Cross />
                      </IconButton>
                    </Flex>
                    <Typography variant="epsilon" style={{ 
                      color: 'rgba(255,255,255,0.9)', 
                      fontSize: '16px',
                      fontWeight: '400',
                    }}>
                      {createdTokenData.email}
                    </Typography>
                  </Flex>
                </Box>

                {/* Body */}
                <Box padding={7}>
                  <Flex direction="column" alignItems="stretch" gap={5}>
                    {/* Warning */}
                    <Box
                      padding={4}
                      style={{
                        borderRadius: '8px',
                        background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
                        border: '1px solid #f59e0b',
                      }}
                    >
                      <Flex alignItems="flex-start" gap={3}>
                        <WarningCircle style={{ width: '24px', height: '24px', color: '#d97706', flexShrink: 0 }} />
                        <Typography variant="omega" style={{ color: '#92400e', lineHeight: '1.6' }}>
                          {formatMessage({ id: getTrad('tokens.created.warning') })}
                        </Typography>
                      </Flex>
                    </Box>

                    {/* Plaintext Token */}
                    <Box>
                      <Typography variant="sigma" fontWeight="semiBold" textColor="neutral800" style={{ marginBottom: '8px', textTransform: 'uppercase', fontSize: '12px', letterSpacing: '0.5px' }}>
                        {formatMessage({ id: getTrad('tokens.created.plaintextToken') })}
                      </Typography>
                      <Box
                        padding={4}
                        style={{
                          borderRadius: '8px',
                          cursor: 'pointer',
                          position: 'relative',
                          transition: 'all 0.2s',
                          background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
                          border: '2px solid #22c55e',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = '#dcfce7';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)';
                        }}
                        onClick={() => {
                          navigator.clipboard.writeText(createdTokenData.token);
                          toggleNotification({
                            type: 'success',
                            message: formatMessage({ id: getTrad('tokens.notifications.tokenCopied') }),
                          });
                        }}
                      >
                        <Typography 
                          variant="pi" 
                          style={{ 
                            fontFamily: 'monospace', 
                            fontSize: '16px',
                            fontWeight: '600',
                            wordBreak: 'break-all',
                            display: 'block',
                            marginBottom: '8px',
                            color: '#166534',
                            letterSpacing: '1px',
                          }}
                        >
                          {createdTokenData.token}
                        </Typography>
                        <Typography variant="pi" textColor="success700" style={{ fontSize: '11px', fontStyle: 'italic' }}>
                          {formatMessage({ id: getTrad('tokens.details.clickToCopy') })}
                        </Typography>
                      </Box>
                    </Box>

                    {/* Magic Link */}
                    <Box>
                      <Typography variant="sigma" fontWeight="semiBold" textColor="neutral800" style={{ marginBottom: '8px', textTransform: 'uppercase', fontSize: '12px', letterSpacing: '0.5px' }}>
                        {formatMessage({ id: getTrad('tokens.details.magicLink') })}
                      </Typography>
                      <Box
                        padding={4}
                        background="primary100"
                        style={{
                          borderRadius: '6px',
                          cursor: 'pointer',
                          position: 'relative',
                          transition: 'all 0.2s',
                          border: '1px solid #c7d2fe',
                        }}
                        onClick={() => {
                          const magicLink = `${window.location.origin}/api/magic-link/login?loginToken=${createdTokenData.token}`;
                          navigator.clipboard.writeText(magicLink);
                          toggleNotification({
                            type: 'success',
                            message: formatMessage({ id: getTrad('tokens.notifications.linkCopied') }),
                          });
                        }}
                      >
                        <Typography 
                          variant="pi" 
                          style={{ 
                            fontSize: '13px',
                            wordBreak: 'break-all',
                            display: 'block',
                            marginBottom: '8px',
                            lineHeight: '1.6',
                            color: '#271fe0',
                          }}
                        >
                          {`${window.location.origin}/api/magic-link/login?loginToken=${createdTokenData.token}`}
                        </Typography>
                        <Typography variant="pi" textColor="primary600" style={{ fontSize: '11px', fontStyle: 'italic' }}>
                          {formatMessage({ id: getTrad('tokens.details.clickToCopy') })}
                        </Typography>
                      </Box>
                    </Box>

                    {/* Expiry Info */}
                    <Box
                      padding={4}
                      background="neutral100"
                      style={{
                        borderRadius: '6px',
                        border: '1px solid #e0e0e8',
                      }}
                    >
                      <Flex alignItems="center" justifyContent="space-between">
                        <Typography variant="omega" textColor="neutral600" style={{ fontSize: '12px' }}>
                          {formatMessage({ id: getTrad('tokens.details.expiresAt') })}
                        </Typography>
                        <Typography variant="pi" style={{ fontSize: '13px', fontWeight: '500' }}>
                          {formatDate(createdTokenData.expires_at) || formatMessage({ id: getTrad('tokens.details.unlimited') })}
                        </Typography>
                      </Flex>
                    </Box>
                  </Flex>
                </Box>

                {/* Footer */}
                <Box
                  paddingTop={5}
                  paddingBottom={5}
                  paddingLeft={7}
                  paddingRight={7}
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
                        const magicLink = `${window.location.origin}/api/magic-link/login?loginToken=${createdTokenData.token}`;
                        navigator.clipboard.writeText(magicLink);
                        toggleNotification({
                          type: 'success',
                          message: formatMessage({ id: getTrad('tokens.notifications.linkCopied') }),
                        });
                      }}
                      size="M"
                      variant="secondary"
                      startIcon={<Link />}
                    >
                      {formatMessage({ id: getTrad('tokens.created.copyLink') })}
                    </Button>
                    <Button 
                      onClick={() => setShowCreatedTokenModal(false)}
                      size="M"
                      variant="success"
                    >
                      {formatMessage({ id: getTrad('tokens.created.done') })}
                    </Button>
                  </Flex>
                </Box>
              </Box>
            </div>
          </>
        )}
        
        {/* Extend Token Modal */}
        <ExtendTokenModal
          isOpen={showExtendModal}
          onClose={() => {
            setShowExtendModal(false);
            setSelectedTokenToExtend(null);
          }}
          onSubmit={handleExtend}
          selectedToken={selectedTokenToExtend}
          extendDays={extendDays}
          setExtendDays={setExtendDays}
          formatDate={formatDate}
        />
        
        {/* Create Token Modal */}
        <CreateTokenModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSubmit={handleCreateToken}
          formData={newToken}
          setFormData={setNewToken}
        />
      </Container>
    </Main>
  );
};

export default TokensProfessional;
