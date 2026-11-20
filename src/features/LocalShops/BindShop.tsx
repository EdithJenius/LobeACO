import { Alert, Button, Flexbox, Input, Text, useModalContext } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { LocalShopData } from '@/services/localShops';
import { localShopsActions } from '@/store/localShops';

import { buyerPlatforms, shopPlatforms } from './platforms';
import { styles } from './style';

export const BindShop = ({
  connected,
  removed,
}: {
  connected: string[];
  removed: NonNullable<LocalShopData['removed']>;
}) => {
  const { t } = useTranslation('agent');
  const { close } = useModalContext();
  const [platform, setPlatform] = useState('taobao');
  const buyer = platform.endsWith('-buyer');
  const [created, setCreated] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const bind = async () => {
    setBusy(true);
    setError('');
    try {
      const account =
        created ||
        (await localShopsActions.command<{ id: string }>({ action: 'create', name, platform })).id;
      setCreated(account);
      await localShopsActions.command({ account, action: 'login' });
      close();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Flexbox gap={16}>
      <Flexbox horizontal gap={8} role="group" aria-label={t('shops.accountRole')}>
        {[false, true].map((isBuyer) => (
          <Button
            aria-pressed={buyer === isBuyer}
            disabled={busy || Boolean(created)}
            key={String(isBuyer)}
            type={buyer === isBuyer ? 'primary' : 'default'}
            onClick={() => {
              const choices = isBuyer ? buyerPlatforms : shopPlatforms;
              const next = platform.replace(/-buyer$/, '') + (isBuyer ? '-buyer' : '');
              setPlatform(choices.some((p) => p.id === next) ? next : choices[0].id);
            }}
          >{t(isBuyer ? 'shops.buyerAccount' : 'shops.merchantAccount')}</Button>
        ))}
      </Flexbox>
      <div {...stylex.props(styles.guides)}>
        <div {...stylex.props(styles.hint)}>
          <Text strong>{t('shops.selectPlatform')}</Text>
          <div {...stylex.props(styles.meta)}>{t(buyer ? 'shops.buyerHint' : 'shops.bindHint')}</div>
        </div>
        <div {...stylex.props(styles.hint)}>
          <Text strong>{t('shops.signInPlatform')}</Text>
          <div {...stylex.props(styles.meta)}>{t(buyer ? 'shops.buyerLoginHint' : 'shops.manualGuide')}</div>
        </div>
      </div>
      <div aria-label={t('shops.selectPlatform')} role="group" {...stylex.props(styles.grid)}>
        {(buyer ? buyerPlatforms : shopPlatforms).map((item) => (
          <button
            aria-pressed={platform === item.id}
            disabled={busy || Boolean(created)}
            key={item.id}
            type="button"
            {...stylex.props(styles.tile, platform === item.id && styles.chosen)}
            onClick={() => setPlatform(item.id)}
          >
            <img
              alt=""
              height={30}
              src={item.icon}
              style={{ objectFit: 'contain', borderRadius: 7 }}
              width={30}
            />
            {item.name}
            {connected.includes(item.id) && (
              <span {...stylex.props(styles.connected)}>{t('shops.connected')}</span>
            )}
            {item.id === platform && (
              <Check size={14} style={{ position: 'absolute', right: 10, top: 10 }} />
            )}
          </button>
        ))}
      </div>
      {removed
        .filter((shop) => shop.platform === platform)
        .map((shop) => (
          <Flexbox horizontal align="center" justify="space-between" key={shop.id}>
            <Text>{shop.name}</Text>
            <Button
              disabled={busy || Boolean(created)}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await localShopsActions.command({ account: shop.id, action: 'rebind' });
                  close();
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t('shops.rebind')}
            </Button>
          </Flexbox>
        ))}
      <details>
        <summary {...stylex.props(styles.disclosure)}>{t('shops.optionalName')}</summary>
        <Input
          aria-label={t('shops.shopName')}
          disabled={busy || Boolean(created)}
          maxLength={80}
          placeholder={t('shops.shopName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </details>
      {error && <Alert title={error} type="error" />}
      <Flexbox horizontal gap={10} justify="center">
        <Button disabled={busy} shape="round" onClick={close}>
          {t('shops.cancelBind')}
        </Button>
        <Button loading={busy} shape="round" type="primary" onClick={bind}>
          {t('shops.bindNow')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
};
