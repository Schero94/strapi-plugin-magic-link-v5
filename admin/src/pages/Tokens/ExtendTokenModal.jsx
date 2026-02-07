import { useState } from 'react';
import { useIntl } from 'react-intl';
import {
  Typography,
  Box,
  Flex,
  Button,
  IconButton,
  TextInput,
} from '@strapi/design-system';
import { Cross, Check } from '@strapi/icons';
import getTrad from '../../utils/getTrad';

const ExtendTokenModal = ({ 
  isOpen, 
  onClose, 
  onSubmit, 
  selectedToken,
  extendDays,
  setExtendDays,
  formatDate 
}) => {
  const { formatMessage } = useIntl();
  const [customDays, setCustomDays] = useState('');
  const [isCustomMode, setIsCustomMode] = useState(false);

  if (!isOpen || !selectedToken) return null;

  const getButtonStyle = (isActive) => ({
    flex: '1 1 calc(50% - 6px)',
    minWidth: '100px',
    padding: '16px 12px',
    fontSize: '15px',
    fontWeight: isActive ? '600' : '500',
  });

  const isValidDays = (value) => value && !isNaN(parseInt(value));

  const calculateNewExpiryDate = () => {
    const currentExpiry = selectedToken.expires_at ? new Date(selectedToken.expires_at) : new Date();
    const newExpiry = new Date(currentExpiry);
    newExpiry.setDate(newExpiry.getDate() + extendDays);
    return formatDate(newExpiry);
  };

  const handleSubmit = () => {
    onSubmit(selectedToken.id);
  };

  const handlePresetClick = (days) => {
    setIsCustomMode(false);
    setExtendDays(days);
  };

  const handleCustomClick = () => {
    setIsCustomMode(true);
    if (isValidDays(customDays)) {
      setExtendDays(parseInt(customDays));
    }
  };

  const handleCustomInputChange = (e) => {
    const value = e.target.value;
    setCustomDays(value);
    if (isValidDays(value)) {
      setExtendDays(parseInt(value));
    }
  };

  return (
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
        onClick={onClose}
      >
        {/* Modal Content */}
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
              borderBottom: '1px solid rgba(128, 128, 128, 0.15)',
            }}
          >
            <Flex direction="column" gap={1} alignItems="flex-start">
              <Typography variant="beta" textColor="neutral800" style={{ fontSize: '16px', fontWeight: '600' }}>
                {formatMessage({ id: getTrad('tokens.extend.title') })}
              </Typography>
              <Typography variant="pi" textColor="neutral500" style={{ fontSize: '13px' }}>
                {selectedToken.email}
              </Typography>
            </Flex>
            <IconButton
              onClick={onClose}
              label={formatMessage({ id: getTrad('tokens.details.close') })}
              withTooltip={false}
            >
              <Cross />
            </IconButton>
          </Flex>

          {/* Body */}
          <Box paddingTop={6} paddingBottom={6} paddingLeft={6} paddingRight={6}>
            <Flex direction="column" gap={5}>
              {/* Current Status */}
              <Box 
                padding={3} 
                background="neutral100"
                style={{ 
                  borderRadius: '6px',
                  textAlign: 'center',
                  border: '1px solid rgba(128, 128, 128, 0.15)',
                }}
              >
                <Typography 
                  variant="omega" 
                  textColor="neutral500"
                  style={{ fontSize: '11px', display: 'block', marginBottom: '4px' }}
                >
                  {formatMessage({ id: getTrad('tokens.extend.currentExpiry') })}
                </Typography>
                <Typography variant="pi" textColor="neutral800" style={{ fontSize: '15px', fontWeight: '600' }}>
                  {formatDate(selectedToken.expires_at) || formatMessage({ id: getTrad('tokens.details.unlimited') })}
                </Typography>
              </Box>

              {/* Extension Period Selection */}
              <Box>
                <Typography 
                  variant="omega" 
                  textColor="neutral600"
                  style={{ fontSize: '12px', marginBottom: '12px', display: 'block' }}
                >
                  {formatMessage({ id: getTrad('tokens.extend.selectExtension') })}
                </Typography>
                <Flex gap={3} wrap="wrap">
                  <Button
                    variant={extendDays === 1 && !isCustomMode ? 'default' : 'tertiary'}
                    size="L"
                    onClick={() => handlePresetClick(1)}
                    style={getButtonStyle(extendDays === 1 && !isCustomMode)}
                  >
                    {formatMessage({ id: getTrad('tokens.extend.preset1') })}
                  </Button>
                  <Button
                    variant={extendDays === 7 && !isCustomMode ? 'default' : 'tertiary'}
                    size="L"
                    onClick={() => handlePresetClick(7)}
                    style={getButtonStyle(extendDays === 7 && !isCustomMode)}
                  >
                    {formatMessage({ id: getTrad('tokens.extend.preset7') })}
                  </Button>
                  <Button
                    variant={extendDays === 30 && !isCustomMode ? 'default' : 'tertiary'}
                    size="L"
                    onClick={() => handlePresetClick(30)}
                    style={getButtonStyle(extendDays === 30 && !isCustomMode)}
                  >
                    {formatMessage({ id: getTrad('tokens.extend.preset30') })}
                  </Button>
                  <Button
                    variant={extendDays === 90 && !isCustomMode ? 'default' : 'tertiary'}
                    size="L"
                    onClick={() => handlePresetClick(90)}
                    style={getButtonStyle(extendDays === 90 && !isCustomMode)}
                  >
                    {formatMessage({ id: getTrad('tokens.extend.preset90') })}
                  </Button>
                </Flex>
                
                {/* Custom Days Input */}
                <Box marginTop={3}>
                  <Flex gap={2} alignItems="flex-end">
                    <Box style={{ flex: 1 }}>
                      <TextInput
                        label={formatMessage({ id: getTrad('tokens.extend.customDays') })}
                        placeholder={formatMessage({ id: getTrad('tokens.extend.customPlaceholder') })}
                        value={customDays}
                        onChange={handleCustomInputChange}
                        onFocus={handleCustomClick}
                        type="number"
                        min="1"
                        style={{ fontSize: '14px' }}
                      />
                    </Box>
                    <Button
                      variant={isCustomMode ? 'default' : 'tertiary'}
                      size="L"
                      onClick={handleCustomClick}
                      disabled={!isValidDays(customDays)}
                      style={{ 
                        padding: '12px 20px',
                        fontSize: '14px',
                      }}
                    >
                      {formatMessage({ id: getTrad('tokens.extend.custom') })}
                    </Button>
                  </Flex>
                </Box>
              </Box>

              {/* New Expiry Date */}
              <Box>
                <Flex alignItems="center" gap={1} style={{ marginBottom: '8px' }}>
                  <Check style={{ width: '14px', height: '14px', color: '#16a34a' }} />
                  <Typography variant="omega" textColor="success600" style={{ fontSize: '12px' }}>
                    {formatMessage({ id: getTrad('tokens.extend.newExpiry') })}
                  </Typography>
                </Flex>
                <Box 
                  padding={3} 
                  style={{ 
                    borderRadius: '6px',
                    border: '1px solid rgba(22, 163, 74, 0.3)',
                    background: 'rgba(22, 163, 74, 0.06)',
                    textAlign: 'center',
                  }}
                >
                  <Typography variant="pi" textColor="success600" style={{ fontSize: '15px', fontWeight: '600' }}>
                    {calculateNewExpiryDate()}
                  </Typography>
                </Box>
              </Box>
            </Flex>
          </Box>

          {/* Footer */}
          <Box
            paddingTop={5}
            paddingBottom={5}
            paddingLeft={6}
            paddingRight={6}
            background="neutral100"
            style={{
              borderTop: '1px solid rgba(128, 128, 128, 0.12)',
              borderBottomLeftRadius: '8px',
              borderBottomRightRadius: '8px',
            }}
          >
            <Flex justifyContent="flex-end" gap={3}>
              <Button 
                onClick={onClose}
                size="M"
                variant="tertiary"
              >
                {formatMessage({ id: getTrad('tokens.extend.cancel') })}
              </Button>
              <Button 
                onClick={handleSubmit}
                size="M"
                variant="default"
              >
                {formatMessage({ id: getTrad('tokens.extend.submit') })}
              </Button>
            </Flex>
          </Box>
        </Box>
      </div>
  );
};

export default ExtendTokenModal;
