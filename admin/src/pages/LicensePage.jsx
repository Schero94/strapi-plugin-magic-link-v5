import { useState, useEffect } from 'react';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import styled from 'styled-components';
import {
  Box,
  Button,
  Flex,
  Typography,
  Badge,
} from '@strapi/design-system';
import {
  Check as CheckIcon,
  Cross as XMarkIcon,
  Sparkle as SparklesIcon,
  Lightning as BoltIcon,
  Rocket as RocketLaunchIcon,
  Crown as BuildingOfficeIcon,
} from '@strapi/icons';

const Container = styled(Box)`
  padding: 32px;
  max-width: 1400px;
  margin: 0 auto;
`;

const Header = styled(Box)`
  text-align: center;
  margin-bottom: 48px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
`;

const Title = styled(Typography)`
  font-size: 2.5rem;
  font-weight: 700;
  margin-bottom: 8px;
  background: linear-gradient(135deg, #4945ff, #7c3aed);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  display: block;
`;

const Subtitle = styled(Typography)`
  font-size: 1.125rem;
  color: ${(p) => p.theme.colors.neutral600};
  line-height: 1.6;
  display: block;
`;

const TierGrid = styled(Flex)`
  gap: 32px;
  margin: 0 auto 48px;
  max-width: 1080px;
  justify-content: center;
  flex-wrap: wrap;
`;

const TierWrapper = styled(Box)`
  flex: 1;
  min-width: 280px;
  max-width: 340px;
`;

const TierCard = styled(Box)`
  background: ${(p) => p.theme.colors.neutral0};
  border-radius: 16px;
  padding: 32px;
  border: 2px solid ${props => props.$featured ? '#4945ff' : props.theme.colors.neutral200};
  position: relative;
  transition: all 0.3s ease;
  box-shadow: ${props => props.$featured
    ? '0 20px 25px -5px rgba(73, 69, 255, 0.25), 0 8px 10px -6px rgba(73, 69, 255, 0.2)'
    : '0 10px 15px -3px rgba(0, 0, 0, 0.08), 0 4px 6px -4px rgba(0, 0, 0, 0.05)'};

  &:hover {
    transform: translateY(-4px);
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
  }
`;

const PopularBadge = styled(Badge)`
  position: absolute;
  top: -12px;
  right: 24px;
  background: linear-gradient(135deg, #4945ff, #4338ca);
  color: white;
  padding: 4px 16px;
  font-size: 12px;
  font-weight: 600;
`;

const TierIcon = styled(Box)`
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
  background: ${props => props.$color};
  
  svg {
    width: 28px;
    height: 28px;
    color: white;
  }
`;

const TierName = styled(Typography)`
  font-size: 1.5rem;
  font-weight: 700;
  margin-bottom: 8px;
  color: ${(p) => p.theme.colors.neutral800};
`;

const TierPrice = styled(Typography)`
  font-size: 2rem;
  font-weight: 800;
  margin-bottom: 4px;
  color: ${(p) => p.theme.colors.neutral800};
`;

const TierDescription = styled(Typography)`
  color: ${(p) => p.theme.colors.neutral600};
  margin-bottom: 24px;
`;

const LimitsBox = styled(Box)`
  background: ${(p) => p.theme.colors.neutral100};
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 20px;
`;

const LimitText = styled(Typography)`
  font-size: 13px;
  color: ${(p) => p.theme.colors.neutral800};
`;

const PeriodText = styled(Typography)`
  color: ${(p) => p.theme.colors.neutral600};
`;

const FeatureText = styled(Typography)`
  font-size: 14px;
  color: ${(p) => p.$included ? p.theme.colors.neutral800 : p.theme.colors.neutral500};
  text-decoration: ${(p) => p.$included ? 'none' : 'line-through'};
`;

const FeatureList = styled(Box)`
  margin-bottom: 24px;
`;

const Feature = styled(Flex)`
  gap: 12px;
  margin-bottom: 12px;
  align-items: flex-start;
`;

const FeatureIcon = styled(Box)`
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 2px;
  
  ${props => props.$included ? `
    background: rgba(34, 197, 94, 0.15);
    svg { color: #16A34A; }
  ` : `
    background: rgba(220, 38, 38, 0.12);
    svg { color: #DC2626; }
  `}
`;

const UpgradeButton = styled(Button)`
  width: 100%;
  height: 48px;
  font-weight: 600;
  font-size: 15px;
  background: ${props => props.$gradient};
  border: none;
  color: white;
  
  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }
`;

const CurrentPlanBadge = styled(Badge)`
  width: 100%;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${(p) => p.theme.colors.neutral100};
  color: ${(p) => p.theme.colors.neutral600};
  font-weight: 600;
  font-size: 15px;
`;

const LicensePage = () => {
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const [currentTier, setCurrentTier] = useState('free');
  const [limits, setLimits] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLicenseInfo();
  }, []);

  const fetchLicenseInfo = async () => {
    try {
      const response = await get('/magic-link/license/status');
      const licenseData = response.data?.data || response.data;
      
      // Determine tier from features
      let tier = 'free';
      if (licenseData.features) {
        if (licenseData.features.enterprise) {
          tier = 'enterprise';
        } else if (licenseData.features.advanced) {
          tier = 'advanced';
        } else if (licenseData.features.premium) {
          tier = 'premium';
        }
      }
      
      setCurrentTier(tier);
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch license info:', error);
      setLoading(false);
    }
  };

  // Helper function to compare tier ranks
  const getTierRank = (tierId) => {
    const ranks = {
      'free': 0,
      'premium': 1,
      'advanced': 2,
      'enterprise': 3,
    };
    return ranks[tierId] || 0;
  };

  // Get button text based on tier comparison
  const getButtonText = (tierId) => {
    const currentRank = getTierRank(currentTier);
    const targetRank = getTierRank(tierId);
    
    if (currentRank === targetRank) {
      return 'Current Plan';
    } else if (targetRank > currentRank) {
      return 'Upgrade Now';
    } else {
      return 'Downgrade';
    }
  };

  const tiers = [
    {
      id: 'free',
      name: 'FREE',
      price: '$0',
      period: 'forever',
      description: 'Perfect for small projects and testing',
      icon: <SparklesIcon />,
      color: 'linear-gradient(135deg, #6B7280, #4B5563)',
      features: [
        { name: 'Magic Link Authentication', included: true },
        { name: 'Token Management', included: true },
        { name: 'IP Banning & Security', included: true },
        { name: 'Rate Limiting', included: true },
        { name: 'JWT Session Management', included: true },
        { name: 'Email OTP (2FA)', included: false },
        { name: 'TOTP Authenticator', included: false },
        { name: 'Advanced Analytics', included: false },
      ],
      limits: {
        authentication: 'Magic Link Only',
        mfa: 'Not Available',
        support: 'Community',
      }
    },
    {
      id: 'premium',
      name: 'PREMIUM',
      price: '$14.50',
      period: '/month',
      description: 'Enhanced security with Email OTP',
      icon: <BoltIcon />,
      color: 'linear-gradient(135deg, #8B5CF6, #7C3AED)',
      featured: true,
      features: [
        { name: 'Magic Link Authentication', included: true },
        { name: 'Token Management', included: true },
        { name: 'IP Banning & Security', included: true },
        { name: 'Rate Limiting', included: true },
        { name: 'JWT Session Management', included: true },
        { name: 'Email OTP (2FA)', included: true },
        { name: 'Configurable OTP Settings', included: true },
        { name: 'TOTP Authenticator', included: false },
      ],
      limits: {
        authentication: 'Magic Link + Email OTP',
        mfa: 'Email OTP',
        support: 'Priority Support',
      }
    },
    {
      id: 'advanced',
      name: 'ADVANCED',
      price: '$39.50',
      period: '/month',
      description: 'Maximum security with TOTP MFA',
      icon: <RocketLaunchIcon />,
      color: 'linear-gradient(135deg, #0EA5E9, #0284C7)',
      features: [
        { name: 'Magic Link Authentication', included: true },
        { name: 'Token Management', included: true },
        { name: 'IP Banning & Security', included: true },
        { name: 'Rate Limiting', included: true },
        { name: 'JWT Session Management', included: true },
        { name: 'Email OTP (2FA)', included: true },
        { name: 'TOTP Authenticator (MFA)', included: true },
        { name: 'TOTP-Only Login', included: true },
      ],
      limits: {
        authentication: 'All Modes',
        mfa: 'Email OTP + TOTP',
        support: 'Priority + Phone',
      }
    },
    {
      id: 'enterprise',
      name: 'ENTERPRISE',
      price: 'Custom',
      period: 'pricing',
      description: 'Tailored solutions for large organizations',
      icon: <BuildingOfficeIcon />,
      color: 'linear-gradient(135deg, #F59E0B, #D97706)',
      features: [
        { name: 'All Advanced Features', included: true },
        { name: 'White-Label Options', included: true },
        { name: 'Custom Integrations', included: true },
        { name: 'Dedicated Support', included: true },
        { name: 'SLA Guarantee', included: true },
        { name: 'On-Premise Deployment', included: true },
        { name: 'Custom MFA Providers', included: true },
        { name: 'Training & Onboarding', included: true },
      ],
      limits: {
        authentication: 'Unlimited',
        mfa: 'Custom Solutions',
        support: 'Dedicated Team',
      }
    }
  ];

  const handleUpgrade = (tierId) => {
    // Navigate to upgrade URL or show upgrade modal
    window.open('https://store.magicdx.dev/', '_blank');
  };

  if (loading) {
    return (
      <Container>
        <Flex justifyContent="center" alignItems="center" style={{ minHeight: '400px' }}>
          <Typography>Loading license information...</Typography>
        </Flex>
      </Container>
    );
  }

  return (
    <Container>
      <Header>
        <Title variant="alpha">Choose Your Plan</Title>
        <Subtitle variant="omega">
          Unlock powerful authentication features for your Strapi application
        </Subtitle>
      </Header>

      <TierGrid>
        {tiers.filter((tier) => tier.id !== 'enterprise').map((tier) => (
          <TierWrapper key={tier.id}>
            <TierCard $featured={tier.featured}>
              {tier.featured && <PopularBadge>MOST POPULAR</PopularBadge>}
              
              <TierIcon $color={tier.color}>
                {tier.icon}
              </TierIcon>
              
              <TierName variant="beta">{tier.name}</TierName>
              
              <Flex alignItems="baseline" gap={1}>
                <TierPrice variant="alpha">{tier.price}</TierPrice>
                <PeriodText variant="omega">
                  {tier.period}
                </PeriodText>
              </Flex>
              
              <TierDescription variant="omega">
                {tier.description}
              </TierDescription>
              
              {/* Limits Summary */}
              <LimitsBox>
                <Flex direction="column" gap={2}>
                  <LimitText variant="pi">
                    <strong>Authentication:</strong> {tier.limits.authentication}
                  </LimitText>
                  <LimitText variant="pi">
                    <strong>MFA:</strong> {tier.limits.mfa}
                  </LimitText>
                  <LimitText variant="pi">
                    <strong>Support:</strong> {tier.limits.support}
                  </LimitText>
                </Flex>
              </LimitsBox>
              
              <FeatureList>
                {tier.features.map((feature, index) => (
                  <Feature key={index}>
                    <FeatureIcon $included={feature.included}>
                      {feature.included ? (
                        <CheckIcon style={{ width: 14, height: 14 }} />
                      ) : (
                        <XMarkIcon style={{ width: 14, height: 14 }} />
                      )}
                    </FeatureIcon>
                    <FeatureText variant="omega" $included={feature.included}>
                      {feature.name}
                    </FeatureText>
                  </Feature>
                ))}
              </FeatureList>
              
              {currentTier === tier.id ? (
                <CurrentPlanBadge>Current Plan</CurrentPlanBadge>
              ) : (
                <UpgradeButton
                  $gradient={tier.color}
                  onClick={() => handleUpgrade(tier.id)}
                >
                  {getButtonText(tier.id)}
                </UpgradeButton>
              )}
            </TierCard>
          </TierWrapper>
        ))}
      </TierGrid>
    </Container>
  );
};

export default LicensePage;
