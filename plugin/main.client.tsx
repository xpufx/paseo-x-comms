import { useMutation, useQuery } from "@tanstack/react-query";
import { type PluginSurfaceProps, useRpc } from "@getpaseo/plugin";
import React, { useCallback, useMemo, useState } from "react";
import { Alert, Clipboard, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import {
  registryReadRpc,
  daemonAddRpc,
  daemonUpdateRpc,
  daemonRemoveRpc,
  daemonHealthRpc,
  daemonProbeRpc,
  uiPrefsGetRpc,
  uiPrefsSetRpc,
  snapshotRefreshRpc,
  daemonDumpRpc,
  identitySyncRpc,
  serverStatusRpc,
  serverCheckRpc,
  serverLocateRpc,
  serverSetPathRpc,
  introspectAgentsRpc,
  introduceAgentsRpc,
} from "./registry.shared";

const HOST_FORM_HINT =
  "Full pairing link (https://app.paseo.sh/#offer=…) or a direct daemon host (host:port, tcp://…, unix://…).";

// Display form for host values: relay offers are long, so show head...tail.
// The copy icon next to the value always copies the full string.
function displayHost(value: string): string {
  const MAX = 40;
  if (value.length <= MAX) return value;
  const head = value.slice(0, 20);
  const tail = value.slice(-16);
  return `${head}…${tail}`;
}

export function MainSurface({ theme, layout }: PluginSurfaceProps) {
  const callRead = useRpc(registryReadRpc);
  const callAdd = useRpc(daemonAddRpc);
  const callUpdate = useRpc(daemonUpdateRpc);
  const callRemove = useRpc(daemonRemoveRpc);
  const callHealth = useRpc(daemonHealthRpc);
  const callProbe = useRpc(daemonProbeRpc);
  const callPrefsGet = useRpc(uiPrefsGetRpc);
  const callPrefsSet = useRpc(uiPrefsSetRpc);
  const callSnapshotRefresh = useRpc(snapshotRefreshRpc);
  const callDump = useRpc(daemonDumpRpc);
  const callIdentitySync = useRpc(identitySyncRpc);
  const callStatus = useRpc(serverStatusRpc);
  const callCheck = useRpc(serverCheckRpc);
  const callLocate = useRpc(serverLocateRpc);
  const callSetPath = useRpc(serverSetPathRpc);
  const callIntrospect = useRpc(introspectAgentsRpc);
  const callIntroduce = useRpc(introduceAgentsRpc);

  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const [actionResult, setActionResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [prereqsCollapsed, setPrereqsCollapsed] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [dumpState, setDumpState] = useState<Record<string, unknown> | null>(null);
  const [dumpDaemon, setDumpDaemon] = useState<string | null>(null);

  // Introduce: which picker (1 or 2) is expanded, selections, editable message.
  const [expandedPicker, setExpandedPicker] = useState<1 | 2 | null>(null);
  const [introFirst, setIntroFirst] = useState<{ daemon: string; agentId: string; shortId: string; name: string } | null>(null);
  const [introSecond, setIntroSecond] = useState<{ daemon: string; agentId: string; shortId: string; name: string } | null>(null);
  const [introMessage, setIntroMessage] = useState(
    "Hello! I was asked to introduce you. This daemon can communicate with you directly via paseo-cross-daemon-comms.",
  );

  const styles = useMemo(
    () => ({
      screen: {
        flex: 1,
        backgroundColor: theme.colors.surface0,
      },
      screenContent: {
        // The host's surface body extends under the Android nav bar, so pad the
        // content container (not the viewport) to let the last element scroll
        // clear of it on compact form factors.
        padding: layout.compact ? 16 : 24,
        paddingBottom: layout.compact ? 64 : 24,
      },
      title: { color: theme.colors.foreground, fontSize: layout.compact ? 20 : 24, fontWeight: "700" as const },
      titleRow: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const },
      refreshBtn: { padding: 8, borderRadius: 6, borderWidth: 1.5, borderColor: theme.colors.foregroundMuted, minWidth: 44, minHeight: 44, justifyContent: "center" as const, alignItems: "center" as const },
      refreshText: { color: theme.colors.accent, fontSize: 16 },
      section: { color: theme.colors.foreground, fontSize: 16, fontWeight: "600" as const, marginTop: 20 },
      sectionRow: { flexDirection: "row" as const, alignItems: "center" as const, marginTop: 20 },
      sectionHeader: { flexDirection: "row" as const, alignItems: "center" as const, marginTop: 20 },
      chevron: { color: theme.colors.accent, fontSize: 14, marginRight: 8 },
      detail: { color: theme.colors.foregroundMuted, fontSize: 13 },
      detailOk: { color: theme.colors.statusSuccess, fontSize: 13 },
      detailWarn: { color: theme.colors.statusWarning, fontSize: 13 },
      mono: { color: theme.colors.foregroundMuted, fontFamily: "monospace", fontSize: 12 },
      ok: { color: theme.colors.statusSuccess, fontSize: 12 },
      error: { color: theme.colors.statusDanger, fontSize: 13 },
      errorMuted: { color: theme.colors.statusDanger, fontSize: 12 },
      expandLink: { color: theme.colors.accent, fontSize: 12, marginTop: 2 },
      errorDetail: { color: theme.colors.statusDanger, fontSize: 11, fontFamily: "monospace" as const, marginTop: 4 },
      button: { padding: 10, borderRadius: 6, borderWidth: 1.5, borderColor: theme.colors.accent, marginTop: 8, alignSelf: "flex-start" as const, minHeight: 44, justifyContent: "center" as const },
      buttonPressed: { opacity: 0.7 },
      buttonSmall: { padding: 10, borderRadius: 6, borderWidth: 1.5, borderColor: theme.colors.accent, marginTop: 4, alignSelf: "flex-start" as const, minWidth: 44, minHeight: 44, justifyContent: "center" as const },
      buttonDanger: { padding: 10, borderRadius: 6, borderWidth: 1.5, borderColor: theme.colors.statusDanger, marginTop: 8, alignSelf: "flex-start" as const, minHeight: 44, justifyContent: "center" as const },
      buttonText: { color: theme.colors.accent, textAlign: "center" as const, fontWeight: "600" as const },
      buttonTextSmall: { color: theme.colors.accent, textAlign: "center" as const, fontSize: 12, fontWeight: "600" as const },
      buttonTextDanger: { color: theme.colors.statusDanger, textAlign: "center" as const, fontSize: 12 },
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        flexWrap: "wrap" as const,
        rowGap: 8,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.foregroundMuted,
        paddingVertical: layout.compact ? 12 : 6,
      },
      pickerSection: { marginTop: 8 },
      pickerButton: { borderWidth: 1, borderColor: theme.colors.foregroundMuted, borderRadius: 8, padding: 10, marginTop: 6 },
      pickerLabel: { color: theme.colors.foreground, fontSize: 13 },
      pickerGroup: { color: theme.colors.accent, fontSize: 12, fontWeight: "700" as const, marginTop: 10, textTransform: "uppercase" as const, letterSpacing: 0.5 },
      pickerProject: { color: theme.colors.foregroundMuted, fontSize: 11, marginTop: 6, paddingLeft: 10, textTransform: "uppercase" as const, letterSpacing: 0.4 },
      pickerWorkspace: { color: theme.colors.foregroundMuted, fontSize: 12, marginTop: 4, paddingLeft: 20 },
      pickerRow: { flexDirection: "row" as const, alignItems: "center" as const, paddingVertical: 5, paddingLeft: 30, paddingRight: 4 },
      pickerRowSelected: { backgroundColor: theme.colors.accent, borderRadius: 6 },
      pickerRadio: { color: theme.colors.foregroundMuted, fontSize: 16, width: 18 },
      pickerRadioSelected: { color: theme.colors.accent, fontSize: 16, width: 18 },
      pickerAgentText: { color: theme.colors.foreground, fontSize: 13, flexShrink: 1 },
      pickerScroll: { maxHeight: 420 },
      pickerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center" as const, padding: 20 },
      pickerSheet: { backgroundColor: theme.colors.surface0, borderRadius: 12, padding: 16, maxHeight: "80%" as const },
      pickerSheetHeader: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, marginBottom: 8 },
      pickerSheetTitle: { color: theme.colors.foreground, fontSize: 16, fontWeight: "600" as const },
      pickerCloseBtn: { minWidth: 44, minHeight: 44, justifyContent: "center" as const, alignItems: "center" as const },
      pickerCloseText: { color: theme.colors.foregroundMuted, fontSize: 18 },
      backdrop: {
        position: "absolute" as const,
        left: 0, right: 0, top: 0, bottom: 0,
      },
      pickerRowText: { color: theme.colors.foreground, fontSize: 13 },
      pickerRowMeta: { color: theme.colors.foregroundMuted, fontSize: 11 },
      cardRow: {
        borderWidth: 1,
        borderColor: theme.colors.foregroundMuted,
        borderRadius: 8,
        padding: 10,
        marginTop: 8,
      },
      rowName: { color: theme.colors.foreground, fontFamily: "monospace" as const, fontSize: 13, flexShrink: 1 },
      rowMeta: { color: theme.colors.foregroundMuted, fontFamily: "monospace" as const, fontSize: 10 },
      rowValue: { color: theme.colors.foregroundMuted, fontFamily: "monospace" as const, fontSize: 11 },
      copyIcon: { color: theme.colors.accent, fontSize: 16, paddingHorizontal: 8, paddingVertical: 10, minWidth: 44, minHeight: 44, textAlign: "center" as const },
      label: { color: theme.colors.foregroundMuted, fontSize: 12, marginTop: 8 },
      input: {
        color: theme.colors.foreground,
        fontFamily: "monospace" as const,
        fontSize: 12,
        borderWidth: 1,
        borderColor: theme.colors.foregroundMuted,
        borderRadius: 8,
        padding: 8,
        marginTop: 4,
      },
    }),
    [theme, layout.compact],
  );

  const read = useQuery({ queryKey: ["registry-read"], queryFn: () => callRead({}) });
  const health = useQuery({
    queryKey: ["daemon-health"],
    queryFn: () => callHealth({}),
    // Health is a network probe; never let it block the UI.
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const probe = useMutation({ mutationFn: callProbe });
  const prefs = useQuery({ queryKey: ["ui-prefs"], queryFn: () => callPrefsGet({}) });
  React.useEffect(() => {
    if (prefs.data) setPrereqsCollapsed(prefs.data.prereqsCollapsed);
  }, [prefs.data]);
  const prefsSet = useMutation({ mutationFn: callPrefsSet });
  const identitySync = useMutation({
    mutationFn: () => callIdentitySync({}),
    onSuccess: () => void read.refetch(),
  });
  const snapshotRefresh = useMutation({
    mutationFn: () => callSnapshotRefresh({}),
    onSuccess: (result) => {
      setRefreshedAt(new Date(result.updatedAt).toLocaleTimeString());
      setRefreshing(false);
      void read.refetch();
      void health.refetch();
      void introspect.refetch();
      void status.refetch();
    },
    onError: () => setRefreshing(false),
  });
  const dump = useMutation({
    mutationFn: callDump,
    onSuccess: (data) => setDumpState(data as unknown as Record<string, unknown>),
  });
  const introspect = useQuery({
    queryKey: ["introspect"],
    queryFn: () => callIntrospect({}),
    staleTime: 30_000,
  });
  const introduce = useMutation({ mutationFn: callIntroduce });
  const locate = useQuery({ queryKey: ["server-locate"], queryFn: () => callLocate({}) });
  const setPath = useMutation({
    mutationFn: callSetPath,
    onSuccess: () => { void locate.refetch(); void status.refetch(); void check.refetch(); },
  });
  const [serverPathDraft, setServerPathDraft] = useState("");
  const status = useQuery({ queryKey: ["server-status"], queryFn: () => callStatus({}) });
  const check = useQuery({ queryKey: ["server-check"], queryFn: () => callCheck({}), retry: false });
  React.useEffect(() => {
    if (locate.data && serverPathDraft === "") setServerPathDraft(locate.data.path ?? locate.data.defaultPath);
    if (locate.data) void check.refetch();
  }, [locate.data, serverPathDraft]);
  const add = useMutation({ mutationFn: callAdd });
  const update = useMutation({ mutationFn: callUpdate });
  const remove = useMutation({ mutationFn: callRemove });

  // Editing state per daemon: current draft name + value (keyed by original name).
  const [edits, setEdits] = useState<Record<string, { name: string; value: string }>>({});
  const [expandedError, setExpandedError] = useState<Set<string>>(new Set());
  const [rowProbe, setRowProbe] = useState<Record<string, { value: string; error: string | null; saved: boolean } | "pending">>({});
  const [addProbe, setAddProbe] = useState<{ value: string; error: string | null } | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Set<string>>(new Set());

  const applyResult = useCallback(
    (result: unknown) => {
      const r = result as { error?: string | null };
      if (r?.error) throw new Error(r.error);
      void read.refetch();
      void health.refetch();
    },
    [read, health],
  );

  // Probe a candidate host value. Returns true when the save should proceed
  // (reachable, or the user confirms an unreachable daemon), false otherwise.
  // Probe a candidate. Returns "ok" (reachable), "unreachable" (show inline
  // confirm), or "invalid" (format error). No modal; the caller renders the
  // result at the row.
  const probeValue = useCallback(
    (value: string): Promise<"ok" | "unreachable" | "invalid"> =>
      new Promise((resolve) => {
        probe.mutate(
          { value },
          {
            onSuccess: (result) => {
              if (!result.valid) resolve("invalid");
              else if (!result.reachable) resolve("unreachable");
              else resolve("ok");
            },
            onError: () => resolve("unreachable"),
          },
        );
      }),
    [probe],
  );

  const deriveHost = useCallback(() => {
    const offer = newValue.match(/#offer=([A-Za-z0-9_-]+)/);
    if (offer && newName.trim().length === 0) {
      try {
        const payload = JSON.parse(Buffer.from(offer[1], "base64").toString("utf8"));
        if (typeof payload.serverId === "string") setNewName(payload.serverId);
      } catch { /* ignore */ }
    }
  }, [newValue, newName]);

  const handleAdd = useCallback(() => {
    const name = newName.trim();
    const value = newValue.trim();
    if (!name || !value) return;
    setAdding(true);
    probeValue(value).then((outcome) => {
      if (outcome === "invalid") {
        setAddProbe({ value, error: "not a valid host form" });
        setAdding(false);
        return;
      }
      if (outcome === "unreachable") {
        setAddProbe({ value, error: null }); // inline confirm shown at the add row
        setAdding(false);
        return;
      }
      setAddProbe(null);
      add.mutate({ name, value }, { onSuccess: applyResult, onSettled: () => setAdding(false) });
    });
  }, [add, newName, newValue, applyResult, probeValue]);

  const confirmAddAnyway = useCallback(() => {
    const value = newValue.trim();
    const name = newName.trim();
    if (!name || !value) return;
    setAddProbe(null);
    add.mutate({ name, value }, { onSuccess: applyResult });
  }, [add, newName, newValue, applyResult]);

  const handleSave = useCallback(
    (originalName: string) => {
      const draft = edits[originalName];
      if (!draft) return;
      const rename = draft.name.trim() !== originalName ? draft.name.trim() : undefined;
      const value = draft.value.trim() !== "" ? draft.value.trim() : undefined;
      if (!rename && !value) {
        // Nothing changed; just close the editor.
        setEditing((prev) => { const next = new Set(prev); next.delete(originalName); return next; });
        return;
      }
      const targetValue = value ?? draft.value.trim();
      setRowProbe((prev) => ({ ...prev, [originalName]: "pending" }));
      probeValue(targetValue).then((outcome) => {
        if (outcome === "ok") {
          setRowProbe((prev) => { const next = { ...prev }; delete next[originalName]; return next; });
          update.mutate(
            { name: originalName, rename, value },
            {
              onSuccess: applyResult,
              onSettled: () => {
                setEdits((prev) => { const next = { ...prev }; delete next[originalName]; return next; });
                setEditing((prev) => { const next = new Set(prev); next.delete(originalName); return next; });
              },
            },
          );
          return;
        }
        if (outcome === "unreachable") {
          setRowProbe((prev) => ({ ...prev, [originalName]: { value: targetValue, error: null, saved: false } }));
          return;
        }
        setRowProbe((prev) => ({ ...prev, [originalName]: { value: targetValue, error: "not a valid host form", saved: false } }));
      });
    },
    [update, edits, applyResult, probeValue],
  );

  const confirmEditAnyway = useCallback(
    (originalName: string) => {
      const draft = edits[originalName];
      if (!draft) return;
      const rename = draft.name.trim() !== originalName ? draft.name.trim() : undefined;
      const value = draft.value.trim() !== "" ? draft.value.trim() : undefined;
      setRowProbe((prev) => { const next = { ...prev }; delete next[originalName]; return next; });
      update.mutate(
        { name: originalName, rename, value },
        {
          onSuccess: applyResult,
          onSettled: () => {
            setEdits((prev) => { const next = { ...prev }; delete next[originalName]; return next; });
            setEditing((prev) => { const next = new Set(prev); next.delete(originalName); return next; });
          },
        },
      );
    },
    [update, edits, applyResult],
  );

  const handleRemove = useCallback(
    (name: string) => {
      Alert.alert("Remove daemon", `Remove '${name}' from the registry?`, [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => remove.mutate({ name }, { onSuccess: applyResult }) },
      ]);
    },
    [remove, applyResult],
  );

  const canAdd = newName.trim().length > 0 && newValue.trim().length > 0;


  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void identitySync
      .mutateAsync()
      .then(() => snapshotRefresh.mutate())
      .catch(() => snapshotRefresh.mutate());
  }, [identitySync, snapshotRefresh]);

  const togglePrereqs = useCallback(() => {
    setPrereqsCollapsed((prev) => {
      const next = !prev;
      prefsSet.mutate({ prereqsCollapsed: next });
      return next;
    });
  }, [prefsSet]);

  const handleCopy = useCallback((value: string) => {
    void Clipboard.setString(value);
  }, []);

  const handleCopyPath = useCallback(() => {
    if (read.data?.registryPath) void Clipboard.setString(read.data.registryPath);
  }, [read.data?.registryPath]);

  const healthByName = useMemo(() => {
    const map: Record<string, { reachable: boolean; error: string | null; agentCount: number | null }> = {};
    for (const result of health.data?.results ?? []) map[result.name] = result;
    return map;
  }, [health.data]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.screenContent}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.titleRow}>
        <Text style={styles.title}>Cross-daemon comms</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh daemon data"
          onPress={handleRefresh}
          disabled={refreshing}
          style={({ pressed }) => [styles.refreshBtn, pressed && styles.buttonPressed]}
          android_ripple={{ color: "rgba(255,255,255,0.2)" }}
        >
          <Text style={styles.refreshText}>{refreshing ? "⟳" : "↻"}</Text>
        </Pressable>
      </View>
      {refreshedAt ? (
        <Text style={styles.detail}>Last refresh: {refreshedAt}</Text>
      ) : null}

      <Pressable accessibilityRole="button" onPress={togglePrereqs} style={styles.sectionHeader}>
        <Text style={styles.chevron}>{prereqsCollapsed ? "▸" : "▾"}</Text>
        <Text style={styles.section}>Server</Text>
      </Pressable>
      {!prereqsCollapsed ? (
        <>
          {locate.data ? (
            <Text style={styles.detail} selectable>
              {locate.data.path ? `server found${locate.data.configured ? " (configured)" : ""} at ${locate.data.path}` : "server not found"}
            </Text>
          ) : null}
          <Text style={styles.label}>Server path override</Text>
          <TextInput
            style={styles.input}
            value={serverPathDraft}
            onChangeText={setServerPathDraft}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {serverPathDraft.trim().length > 0 &&
          serverPathDraft.trim() !== (locate.data?.path ?? locate.data?.defaultPath) ? (
            <Pressable accessibilityRole="button" onPress={() => setPath.mutate({ path: serverPathDraft.trim() })} style={styles.buttonSmall}>
              <Text style={styles.buttonTextSmall}>{setPath.isPending ? "Setting…" : "Use this path"}</Text>
            </Pressable>
          ) : null}
          {locate.data?.path ? (
            check.data ? (
              <Text style={[styles.detail, check.data.match ? styles.detailOk : styles.detailWarn]} selectable>
                {check.data.error
                  ? `server at ${check.data.path} failed to report a version: ${check.data.error}`
                  : check.data.match
                    ? `server reports v${check.data.version} (matches plugin v${check.data.expected})`
                    : `server reports v${check.data.version}, plugin expects v${check.data.expected}`}
              </Text>
            ) : null
          ) : (
            <Text style={styles.detail}>Server not located. Reinstall the plugin, or set an explicit path above.</Text>
          )}
        </>
      ) : null}

      <View style={styles.sectionRow}>
        <Text style={styles.section}>Registered daemons</Text>
        <Text style={styles.detail}>(Config</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Copy registry path" onPress={handleCopyPath} hitSlop={10}>
          <Text style={styles.copyIcon}>⧉</Text>
        </Pressable>
        <Text style={styles.detail}>)</Text>
      </View>
      {read.isPending ? <Text style={styles.detail}>Loading…</Text> : null}
      {!read.data?.exists ? <Text style={styles.detail}>No registry file yet.</Text> : null}
      {read.data && !read.data.validJson ? (
        <Text style={styles.error}>Registry is not valid JSON: {read.data.parseError}</Text>
      ) : null}
      {health.isPending ? <Text style={styles.detail}>Checking health…</Text> : null}

      {read.data?.daemons.map((daemon) => {
        const draft = edits[daemon.name] ?? { name: daemon.name, value: daemon.value };
        const dirty = draft.name !== daemon.name || draft.value !== daemon.value;
        const h = healthByName[daemon.name];
        const probeState = rowProbe[daemon.name];
        const probeDetail =
          probeState && probeState !== "pending" ? probeState : null;
        return (
          <View key={daemon.name}>
            {editing.has(daemon.name) ? (
              <View style={styles.cardRow}>
                <Text style={styles.label}>Name</Text>
                <TextInput
                  style={styles.input}
                  value={draft.name}
                  onChangeText={(text) => setEdits((prev) => ({ ...prev, [daemon.name]: { name: text, value: draft.value } }))}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Text style={styles.label}>Host value</Text>
                <TextInput
                  style={styles.input}
                  value={draft.value}
                  onChangeText={(text) => setEdits((prev) => ({ ...prev, [daemon.name]: { name: draft.name, value: text } }))}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Pressable accessibilityRole="button" onPress={() => handleSave(daemon.name)} style={styles.buttonSmall}>
                  <Text style={styles.buttonTextSmall}>Save</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setEdits((prev) => { const next = { ...prev }; delete next[daemon.name]; return next; });
                    setEditing((prev) => { const next = new Set(prev); next.delete(daemon.name); return next; });
                  }}
                  style={styles.buttonSmall}
                >
                  <Text style={styles.buttonTextDanger}>Cancel</Text>
                </Pressable>
                {probeState === "pending" ? (
                  <Text style={styles.detail}>Probing host…</Text>
                ) : null}
                {probeDetail ? (
                  <Text style={styles.error}>
                    {probeDetail.error ?? `unreachable now: ${probeDetail.value}`}
                  </Text>
                ) : null}
                {probeDetail && !probeDetail.saved ? (
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                    <Pressable accessibilityRole="button" onPress={() => confirmEditAnyway(daemon.name)} style={styles.buttonSmall}>
                      <Text style={styles.buttonTextDanger}>Save anyway</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setRowProbe((prev) => { const next = { ...prev }; delete next[daemon.name]; return next; })}
                      style={styles.buttonSmall}
                    >
                      <Text style={styles.buttonTextSmall}>Dismiss</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ) : (
              <View style={styles.row}>
                <View style={{ flexShrink: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", columnGap: 8 }}>
                    <Text style={styles.rowName} selectable>{daemon.name}</Text>
                    {daemon.hostname && daemon.hostname !== daemon.name ? (
                      <Text style={styles.rowMeta} selectable>{daemon.hostname}</Text>
                    ) : null}
                    {daemon.serverId ? (
                      <Text style={styles.rowMeta} selectable>{daemon.serverId}</Text>
                    ) : null}
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={styles.rowValue}>{displayHost(daemon.value)}</Text>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Copy host value for ${daemon.name}`} onPress={() => handleCopy(daemon.value)} hitSlop={10}>
                      <Text style={styles.copyIcon}>⧉</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Debug daemon ${daemon.name}`}
                      onPress={() => { setDumpDaemon(daemon.name); dump.mutate({ daemon: daemon.name }); }}
                      hitSlop={10}
                    >
                      <Text style={styles.copyIcon}>{dumpDaemon === daemon.name && dump.isPending ? "…" : "🐞"}</Text>
                    </Pressable>
                  </View>
                  {h ? (
                    h.reachable ? (
                      <Text style={styles.ok} selectable>
                        ✓ reachable {h.agentCount !== null ? `(${h.agentCount} agents)` : ""}
                      </Text>
                    ) : (
                      <View>
                        <Text style={styles.errorMuted} selectable>
                          ✗ unreachable
                          <Text style={styles.expandLink} accessibilityRole="button" onPress={() => setExpandedError((prev) => {
                            const next = new Set(prev);
                            if (next.has(daemon.name)) next.delete(daemon.name); else next.add(daemon.name);
                            return next;
                          })}>
                            {" "}(details)
                          </Text>
                          <Text accessibilityRole="button" onPress={() => void Clipboard.setString(h.error ?? "")}>
                            {" "}⧉
                          </Text>
                        </Text>
                        {expandedError.has(daemon.name) ? (
                          <Text style={styles.errorDetail} selectable>{h.error ?? "unreachable"}</Text>
                        ) : null}
                      </View>
                    )
                  ) : (
                    <Text style={styles.detail}>…</Text>
                  )}
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginLeft: 8 }}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setEdits((prev) => ({ ...prev, [daemon.name]: { name: daemon.name, value: daemon.value } }));
                      setEditing((prev) => new Set(prev).add(daemon.name));
                    }}
                    style={styles.buttonSmall}
                  >
                    <Text style={styles.buttonTextSmall}>Edit</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={() => handleRemove(daemon.name)} style={styles.buttonSmall}>
                    <Text style={styles.buttonTextDanger}>Remove</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        );
      })}

      {dumpState ? (
        <View style={styles.cardRow}>
          {(() => {
            const d = dumpState as any;
            return (
              <>
                <Text style={styles.mono} selectable>{d.name}{d.reached ? " (reached)" : " (unreachable)"} · transport: {String(d.transport ?? "-")}</Text>
                {d.error ? <Text style={styles.error}>{d.error}</Text> : null}
                {d.serverId ? <Text style={styles.mono} selectable>serverId: {d.serverId}</Text> : null}
                {d.hostname ? <Text style={styles.mono} selectable>hostname: {d.hostname}</Text> : null}
                {d.version ? <Text style={styles.mono} selectable>version: {d.version}{d.desktopManaged ? " (desktop-managed)" : ""}</Text> : null}
                {d.listen ? <Text style={styles.mono} selectable>listen: {d.listen}</Text> : null}
                {d.pid ? <Text style={styles.mono} selectable>pid: {d.pid}{d.nodePath ? ` · node: ${d.nodePath}` : ""}</Text> : null}
                {d.startedAt ? <Text style={styles.mono} selectable>startedAt: {d.startedAt}</Text> : null}
                {d.relayEndpoints ? <Text style={styles.mono} selectable>relay: {d.relayEnabled ? "enabled" : "disabled"} {d.relayEndpoints.join(", ")}</Text> : null}
                {d.features ? (
                  <>
                    <Text style={styles.detail}>features:</Text>
                    {Object.entries(d.features).filter(([, v]) => v).map(([k]) => (
                      <Text key={k} style={styles.mono} selectable>  {k}</Text>
                    ))}
                  </>
                ) : null}
                {d.capabilities ? (
                  <>
                    <Text style={styles.detail}>capabilities:</Text>
                    {Object.entries(d.capabilities).map(([k, v]) => (
                      <Text key={k} style={styles.mono} selectable>  {k}: {String(v)}</Text>
                    ))}
                  </>
                ) : null}
                <Text style={styles.detail}>agents: {d.agents?.length ?? 0}</Text>
                {d.agents?.map((a: any) => (
                  <Text key={a.agentId} style={styles.mono} selectable>
                    {"  "}{a.status} {a.name} ({a.shortId}) {a.provider}{a.model ? `/${a.model}` : ""}{a.archived ? " [archived]" : ""}{a.cwd ? ` · ${a.cwd}` : ""}
                  </Text>
                ))}
                <Text style={styles.detail}>workspaces: {d.workspaces?.length ?? 0}</Text>
                {d.workspaces?.map((w: any) => (
                  <Text key={w.id ?? w.name} style={styles.mono} selectable>  {w.project}/{w.name} ({w.isolation}){w.cwd ? ` · ${w.cwd}` : ""}</Text>
                ))}
                <Text style={styles.detail}>projects: {d.projects?.length ?? 0}</Text>
                {d.projects?.map((p: any) => (
                  <Text key={p.id ?? p.name} style={styles.mono} selectable>  {p.name}{p.source ? ` · ${p.source}` : ""}</Text>
                ))}
                <Text style={styles.detail}>providers: {d.providerCount ?? d.providers?.length ?? 0}</Text>
                {d.providers?.map((p: any) => (
                  <Text key={String(p.provider)} style={styles.mono} selectable>  {p.available ? "ok" : "x"} {String(p.provider)}{p.error ? ` · ${String(p.error)}` : ""}</Text>
                ))}
                <Text style={styles.detail}>terminals: {d.terminals?.length ?? 0}</Text>
                {d.terminals?.map((t: any) => (
                  <Text key={String(t.id ?? t.name)} style={styles.mono} selectable>  {String(t.name ?? t.id)}{t.status ? ` · ${String(t.status)}` : ""}{t.cwd ? ` · ${String(t.cwd)}` : ""}</Text>
                ))}
                <Text style={styles.detail}>schedules: {d.schedules?.length ?? 0}</Text>
                {d.schedules?.map((sched: any) => (
                  <Text key={String(sched.id ?? sched.name)} style={styles.mono} selectable>  {String(sched.state)} {String(sched.name)}</Text>
                ))}
                <Text style={styles.detail}>permissions: {d.permissions?.length ?? 0}</Text>
                {d.permissions?.map((p: any) => (
                  <Text key={String(p.id)} style={styles.mono} selectable>  {String(p.name)} ({String(p.agentId).slice(0, 8)})</Text>
                ))}
              </>
            );
          })()}
        </View>
      ) : null}

      <Text style={styles.section}>Add daemon</Text>
      <Text style={styles.label}>Host (the daemon's real name; derived for relay links)</Text>
      <TextInput
        style={styles.input}
        value={newName}
        onChangeText={setNewName}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={styles.label}>Host value</Text>
      {newName.trim().length > 0 && newValue.trim().length > 0 && !newValue.includes("#offer=") ? (
        (() => {
          const urlHost = newValue.replace(/^tcp:\/\//, "").replace(/^ws:\/\//, "").replace(/\?.*$/, "").split(":")[0];
          const nameHost = newName.trim().split(":")[0];
          if (urlHost && nameHost && urlHost !== nameHost && !nameHost.includes(urlHost) && !urlHost.includes(nameHost)) {
            return <Text style={styles.error}>host '{nameHost}' does not match the address host '{urlHost}'</Text>;
          }
          return null;
        })()
      ) : null}
      <TextInput
        style={styles.input}
        value={newValue}
        onChangeText={(text) => { setNewValue(text); deriveHost(); }}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={HOST_FORM_HINT}
        placeholderTextColor={theme.colors.foregroundMuted}
      />
      {add.error ? <Text style={styles.error}>{add.error.message}</Text> : null}
      {adding ? <Text style={styles.detail}>Probing host…</Text> : null}
      {addProbe ? (
        <>
          <Text style={styles.error}>
            {addProbe.error ?? `unreachable now: ${addProbe.value}`}
          </Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
            <Pressable accessibilityRole="button" onPress={confirmAddAnyway} style={styles.buttonSmall}>
              <Text style={styles.buttonTextDanger}>Add anyway</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setAddProbe(null)} style={styles.buttonSmall}>
              <Text style={styles.buttonTextSmall}>Dismiss</Text>
            </Pressable>
          </View>
        </>
      ) : null}
      <Pressable accessibilityRole="button" onPress={handleAdd} disabled={!canAdd || add.isPending || adding} style={styles.button}>
        <Text style={styles.buttonText}>{add.isPending ? "Adding…" : adding ? "Probing…" : "Add daemon"}</Text>
      </Pressable>
      {update.error ? <Text style={styles.error}>{update.error.message}</Text> : null}
      {remove.error ? <Text style={styles.error}>{remove.error.message}</Text> : null}

      <Text style={styles.section}>Introduce agents</Text>
      <Text style={styles.detail}>
        Pick two agents on reachable daemons; a message is sent to both.
      </Text>

      {([1, 2] as const).map((slot) => {
        const selected = slot === 1 ? introFirst : introSecond;
        const setSelected = slot === 1 ? setIntroFirst : setIntroSecond;
        return (
          <View key={`intro-${slot}`} style={styles.pickerSection}>
            <Pressable accessibilityRole="button" onPress={() => setExpandedPicker(expandedPicker === slot ? null : slot)} style={styles.pickerButton}>
              <Text style={styles.pickerLabel}>
                {selected
                  ? `${selected.name} (${selected.shortId}) on ${selected.daemon}`
                  : `Select agent ${slot}…`}
              </Text>
            </Pressable>
            <Modal
              visible={expandedPicker === slot}
              transparent
              animationType="fade"
              onRequestClose={() => setExpandedPicker(null)}
            >
              <View style={styles.pickerBackdrop}>
                <View style={styles.pickerSheet}>
                  <View style={styles.pickerSheetHeader}>
                    <Text style={styles.pickerSheetTitle}>Select agent {slot}</Text>
                    <Pressable accessibilityRole="button" accessibilityLabel="Close picker" onPress={() => setExpandedPicker(null)} style={styles.pickerCloseBtn}>
                      <Text style={styles.pickerCloseText}>✕</Text>
                    </Pressable>
                  </View>
                  {introspect.isPending ? <Text style={styles.pickerRowText}>Loading agents…</Text> : null}
                  {introspect.error ? <Text style={styles.error}>{introspect.error.message}</Text> : null}
                  <ScrollView style={styles.pickerScroll}>
                    {introspect.data?.daemons.map((daemon) => (
                      <View key={daemon.name}>
                        <Text style={styles.pickerGroup}>
                          {daemon.reachable ? daemon.name : `${daemon.name} (unreachable)`}
                        </Text>
                        {daemon.projects.map((project) => (
                          <View key={`${daemon.name}-${project.project}`}>
                            <Text style={styles.pickerProject}>{project.project}</Text>
                            {project.workspaces.map((workspace) => (
                              <View key={`${daemon.name}-${project.project}-${workspace.name}`}>
                                <Text style={styles.pickerWorkspace}>⌂ {workspace.name}</Text>
                                {workspace.agents.map((agent) => {
                                  const active = selected?.agentId === agent.agentId;
                                  return (
                                    <Pressable
                                      key={agent.agentId}
                                      accessibilityRole="button"
                                      onPress={() => {
                                        setSelected({ daemon: daemon.name, agentId: agent.agentId, shortId: agent.shortId, name: agent.name });
                                        setExpandedPicker(null);
                                      }}
                                      style={[styles.pickerRow, active ? styles.pickerRowSelected : null]}
                                    >
                                      <Text style={active ? styles.pickerRadioSelected : styles.pickerRadio}>{active ? "●" : "○"}</Text>
                                      <Text style={styles.pickerAgentText}>
                                        {agent.name} ({agent.shortId}) · {agent.status}
                                      </Text>
                                    </Pressable>
                                  );
                                })}
                              </View>
                            ))}
                          </View>
                        ))}
                      </View>
                    ))}
                  </ScrollView>
                </View>
              </View>
            </Modal>
          </View>
        );
      })}

      <Text style={styles.label}>Message</Text>
      <TextInput
        style={[styles.input, { minHeight: 90 }]}
        multiline
        value={introMessage}
        onChangeText={setIntroMessage}
        autoCapitalize="none"
        autoCorrect={false}
        textAlignVertical="top"
      />
      {introduce.error ? <Text style={styles.error}>{introduce.error.message}</Text> : null}
      {!introFirst || !introSecond ? (
        <Text style={styles.detail}>Select both agents above to enable sending.</Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={() =>
          introduce.mutate({
            first: { daemon: introFirst!.daemon, agentId: introFirst!.agentId, shortId: introFirst!.shortId, name: introFirst!.name },
            second: { daemon: introSecond!.daemon, agentId: introSecond!.agentId, shortId: introSecond!.shortId, name: introSecond!.name },
            message: introMessage,
          })
        }
        disabled={!introFirst || !introSecond || introMessage.trim().length === 0 || introduce.isPending}
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        android_ripple={{ color: "rgba(255,255,255,0.25)" }}
      >
        <Text style={styles.buttonText}>{introduce.isPending ? "Sending…" : "Send introductions"}</Text>
      </Pressable>
      {introduce.data ? (
        introduce.data.sends.map((send) => (
          <Text key={send.agentId} style={send.ok ? styles.ok : styles.error}>
            {send.ok ? `sent to ${send.daemon}/${send.agentId}` : `failed ${send.daemon}/${send.agentId}: ${send.error}`}
          </Text>
        ))
      ) : null}
    </ScrollView>
  );
}