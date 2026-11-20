'use client';

import { Alert, Button, createModal, Flexbox, Text, Upload, useModalContext } from '@lobehub/ui';
import { t } from 'i18next';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Avatar from '@/components/Avatar';
import { usePermission } from '@/hooks/usePermission';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import { importExpertPackage } from '@/services/expertPackage';

import { type ExpertPackage, parseExpertPackage } from './package';

const ImportExpert = () => {
  const { t } = useTranslation('agent');
  const { close, setCanDismissByClickOutside } = useModalContext();
  const { allowed } = usePermission('create_content');
  const [bundle, setBundle] = useState<ExpertPackage>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [done, setDone] = useState(false);
  const parsing = useRef(false);

  useEffect(() => {
    setCanDismissByClickOutside(!busy);
  }, [busy, setCanDismissByClickOutside]);

  const selectFile = async (file: File) => {
    if (parsing.current) return;
    parsing.current = true;
    setBusy(true);
    setError('');
    setBundle(undefined);
    try {
      setBundle(parseExpertPackage(new Uint8Array(await file.arrayBuffer())));
    } catch {
      setError(t('myExperts.invalidPackage'));
    } finally {
      parsing.current = false;
      setBusy(false);
    }
  };

  const importPackage = async () => {
    if (!bundle || busy || !allowed) return;
    const scope = getCacheScope();
    setBusy(true);
    setError('');
    try {
      await importExpertPackage(bundle, setProgress);
      if (getCacheScope() !== scope) throw new Error(t('myExperts.scopeChanged'));
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Flexbox gap={20}>
      {error && <Alert description={error} title={t('myExperts.importFailed')} type="error" />}
      {done ? (
        <>
          <Alert title={t('myExperts.importSuccess')} type="success" />
          <Button block type="primary" onClick={close}>
            {t('myExperts.backToList')}
          </Button>
        </>
      ) : (
        <>
          <Upload
            dragger
            accept=".zip"
            disabled={busy || !allowed}
            onFiles={([file]) => file && void selectFile(file)}
          >
            <Flexbox align="center" gap={8} padding={24}>
              <Text strong>
                {bundle ? t('myExperts.chooseAnother') : t('myExperts.choosePackage')}
              </Text>
              <Text type="secondary">{t('myExperts.packageHint')}</Text>
            </Flexbox>
          </Upload>
          {bundle && (
            <>
              <Flexbox horizontal align="center" gap={16}>
                <Avatar avatar={bundle.avatar} size={56} title={bundle.manifest.name} />
                <Flexbox gap={4}>
                  <Text strong>{bundle.manifest.name}</Text>
                  <Text type="secondary">{bundle.manifest.description}</Text>
                </Flexbox>
              </Flexbox>
              <Text>
                {t('myExperts.packageContents', {
                  count: bundle.skills.length,
                  version: bundle.manifest.version,
                })}
              </Text>
              <Text type="secondary">{t('myExperts.modelDefault')}</Text>
              {bundle.manifest.requirements.length > 0 && (
                <Alert
                  title={t('myExperts.requirements')}
                  type="info"
                  description={
                    <ul>
                      {bundle.manifest.requirements.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  }
                />
              )}
              {busy && (
                <Text type="secondary">
                  {t('myExperts.importing')} {progress}
                </Text>
              )}
              <Button
                block
                disabled={!allowed}
                loading={busy}
                type="primary"
                onClick={importPackage}
              >
                {t('myExperts.confirmImport')}
              </Button>
            </>
          )}
        </>
      )}
    </Flexbox>
  );
};

export const openImportExpert = () =>
  createModal({
    content: <ImportExpert />,
    footer: null,
    title: t('myExperts.create', { ns: 'agent' }),
    width: 560,
  });
