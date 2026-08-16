import * as AzureNotificationHub from 'rn-azure-notification-hub';
import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

/**
 * Replace these with your own hub's *listen-only* access policy, or set
 * `installationManagement: true` below to register through your own backend instead.
 */
const CONNECTION_STRING = process.env.EXPO_PUBLIC_ANH_CONNECTION_STRING ?? '';
const HUB_NAME = process.env.EXPO_PUBLIC_ANH_HUB_NAME ?? '';

const TEMPLATE_BODY = Platform.select({
  ios: '{"aps":{"alert":{"title":"$(title)","body":"$(message)"}}}',
  android: '{"message":{"notification":{"title":"$(title)","body":"$(message)"}}}',
  default: '{}',
});

export default function App() {
  const [log, setLog] = useState<string[]>([]);
  const [installation, setInstallation] = useState<AzureNotificationHub.Installation | null>(null);
  const [tag, setTag] = useState('sports');

  const append = useCallback((line: string) => {
    setLog((previous) => [`${new Date().toLocaleTimeString()}  ${line}`, ...previous].slice(0, 40));
  }, []);

  const refresh = useCallback(async () => {
    setInstallation(await AzureNotificationHub.getInstallationAsync());
  }, []);

  const run = useCallback(
    (label: string, action: () => Promise<unknown>) => async () => {
      try {
        const result = await action();
        append(`${label} → ${JSON.stringify(result) ?? 'ok'}`);
        await refresh();
      } catch (error) {
        append(`${label} ✗ ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    [append, refresh]
  );

  useEffect(() => {
    const subscriptions = [
      AzureNotificationHub.addNotificationReceivedListener((event) => {
        append(`notification: ${event.title ?? '(no title)'} — ${event.body ?? '(no body)'}`);
      }),
      AzureNotificationHub.addInstallationSavedListener((event) => {
        append(`installation saved (${event.installation.installationId ?? 'no id'})`);
        setInstallation(event.installation);
      }),
      AzureNotificationHub.addInstallationSaveFailedListener((event) => {
        append(`installation save failed: ${event.message}`);
      }),
      AzureNotificationHub.addAuthorizationListener((event) => {
        append(`authorization granted: ${event.granted}`);
      }),
    ];

    refresh().catch(() => {});

    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, [append, refresh]);

  const start = run('start', async () => {
    if (!CONNECTION_STRING || !HUB_NAME) {
      throw new Error(
        'Set EXPO_PUBLIC_ANH_CONNECTION_STRING and EXPO_PUBLIC_ANH_HUB_NAME before starting.'
      );
    }
    await AzureNotificationHub.startAsync({
      connectionString: CONNECTION_STRING,
      hubName: HUB_NAME,
    });
    return 'started';
  });

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Azure Notification Hubs</Text>

        <Group name="Lifecycle">
          <Button title="startAsync()" onPress={start} />
          <Button
            title="requestPermissionsAsync()"
            onPress={run('permissions', AzureNotificationHub.requestPermissionsAsync)}
          />
          <Button
            title="setEnabledAsync(false)"
            onPress={run('disable', () => AzureNotificationHub.setEnabledAsync(false))}
          />
          <Button
            title="setEnabledAsync(true)"
            onPress={run('enable', () => AzureNotificationHub.setEnabledAsync(true))}
          />
          <Row label="isStarted()" value={String(AzureNotificationHub.isStarted())} />
        </Group>

        <Group name="Installation">
          <Row label="installationId" value={installation?.installationId ?? '—'} />
          <Row label="pushChannel" value={installation?.pushChannel ?? '—'} />
          <Row label="platform" value={installation?.platform ?? '—'} />
          <Row label="userId" value={installation?.userId ?? '—'} />
          <Row label="tags" value={installation?.tags.join(', ') || '—'} />
          <Row label="templates" value={Object.keys(installation?.templates ?? {}).join(', ') || '—'} />
          <Button
            title="setUserIdAsync('demo-user')"
            onPress={run('setUserId', () => AzureNotificationHub.setUserIdAsync('demo-user'))}
          />
          <Button
            title="saveInstallationAsync()"
            onPress={run('save', AzureNotificationHub.saveInstallationAsync)}
          />
        </Group>

        <Group name="Tags">
          <TextInput style={styles.input} value={tag} onChangeText={setTag} autoCapitalize="none" />
          <Button title="addTagAsync()" onPress={run('addTag', () => AzureNotificationHub.addTagAsync(tag))} />
          <Button
            title="removeTagAsync()"
            onPress={run('removeTag', () => AzureNotificationHub.removeTagAsync(tag))}
          />
          <Button title="clearTagsAsync()" onPress={run('clearTags', AzureNotificationHub.clearTagsAsync)} />
        </Group>

        <Group name="Templates">
          <Button
            title="setTemplateAsync('demo')"
            onPress={run('setTemplate', () =>
              AzureNotificationHub.setTemplateAsync('demo', { body: TEMPLATE_BODY, tags: [tag] })
            )}
          />
          <Button
            title="removeTemplateAsync('demo')"
            onPress={run('removeTemplate', () => AzureNotificationHub.removeTemplateAsync('demo'))}
          />
          <Button
            title="clearTemplatesAsync()"
            onPress={run('clearTemplates', AzureNotificationHub.clearTemplatesAsync)}
          />
        </Group>

        <Group name="Log">
          {log.length === 0 ? <Text style={styles.muted}>Nothing yet.</Text> : null}
          {log.map((line, index) => (
            <Text key={index} style={styles.logLine}>
              {line}
            </Text>
          ))}
        </Group>
      </ScrollView>
    </SafeAreaView>
  );
}

function Group({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupHeader}>{name}</Text>
      {children}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#eef1f5' },
  content: { padding: 16, gap: 16 },
  title: { fontSize: 26, fontWeight: '600' },
  group: { backgroundColor: '#fff', borderRadius: 12, padding: 16, gap: 8 },
  groupHeader: { fontSize: 17, fontWeight: '600', marginBottom: 4 },
  row: { flexDirection: 'row', gap: 8 },
  rowLabel: { flex: 1, color: '#5b6472' },
  rowValue: { flex: 2, fontVariant: ['tabular-nums'] },
  input: {
    borderWidth: 1,
    borderColor: '#d5dae2',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  logLine: { fontSize: 12, color: '#333' },
  muted: { color: '#8a94a2' },
});
