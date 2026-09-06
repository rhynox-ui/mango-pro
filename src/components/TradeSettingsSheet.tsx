// src/components/TradeSettingsSheet.tsx
//
// Real trade-settings bottom sheet, gear-triggered from TokenTradeScreen
// — ported from mango-mobile's own src/wallet/SwapSettingsSheet.tsx.
// That gear icon used to open the app-level account Settings screen,
// which was simply the wrong destination (this screen has nothing to do
// with account settings) — this sheet is what it should have opened all
// along: the same real Slippage control mango-mobile already ships.
//
// Real presets kept as-is on purpose (Auto/0.5%/1%/3%, matching
// mobile's own): Auto lets Relay's own front-running-aware calculation
// apply (no slippageTolerance sent at all — see relayQuote.ts's own
// header for that field), a real behavior worth keeping, not a cosmetic
// choice to redesign.
//
// Draft/commit, not "every tap writes state": opening the sheet snapshots
// the real committed slippageBps into local draft state; picking a
// preset or typing Custom only edits the draft. Save calls onSave (the
// parent's setSlippageBps) and closes. Closing via the backdrop tap /
// swipe-to-dismiss (BottomSheet's own gesture) calls onClose directly,
// never onSave — the draft is simply discarded.
//
// No haptics here — mango-mobile's own version calls hapticImpact() on
// every chip tap and Save, but mango-pro has no haptics module ported
// yet (nothing in this app currently uses one); adding haptics just for
// this one sheet would be a new cross-cutting dependency for a single
// call site, not a scoped part of this sheet's own job.

import React, {useEffect, useMemo, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {AppTextInput} from '../onboarding/ui';
import {useTheme, type Colors} from '../theme/ThemeContext';
import {BottomSheet} from './BottomSheet';

// Bps strings matching Relay's own request field exactly, so the
// selected value can be passed to getRelayQuote() with no conversion.
// null means "Auto": the slippageTolerance field is omitted entirely
// and Relay computes it.
export const SLIPPAGE_PRESETS_BPS: (string | null)[] = [null, '50', '100', '300'];

export function slippagePresetLabel(bps: string | null): string {
  return bps === null ? 'Auto' : `${(Number(bps) / 100).toString()}%`;
}

// Parses a user-typed percent string ("2.5") into a Relay-shaped bps
// string ("250"), same 0–10000 bps range Relay's own schema documents.
// Returns null for anything unparseable or out of range.
export function bpsFromPercentInput(input: string): string | null {
  const pct = Number(input);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
    return null;
  }
  const bps = Math.round(pct * 100);
  return bps > 0 && bps <= 10000 ? String(bps) : null;
}

export function TradeSettingsSheet({
  visible,
  onClose,
  slippageBps,
  onSave,
}: {
  visible: boolean;
  onClose: () => void;
  slippageBps: string | null;
  onSave: (bps: string | null) => void;
}) {
  const {colors} = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [draftBps, setDraftBps] = useState<string | null>(slippageBps);
  const [draftCustomText, setDraftCustomText] = useState('');
  const isCustomDraft = draftBps !== null && !SLIPPAGE_PRESETS_BPS.includes(draftBps);

  // Re-snapshot from the real committed value every time the sheet
  // opens — never carries a stale/discarded draft into the next open.
  useEffect(() => {
    if (visible) {
      setDraftBps(slippageBps);
      setDraftCustomText(slippageBps !== null && !SLIPPAGE_PRESETS_BPS.includes(slippageBps) ? String(Number(slippageBps) / 100) : '');
    }
  }, [visible, slippageBps]);

  function handleSave() {
    onSave(draftBps);
    onClose();
  }

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Trade Settings</Text>
        <View style={styles.activeBadge}>
          <Text style={styles.activeBadgeText}>Active: {slippagePresetLabel(slippageBps)}</Text>
        </View>
      </View>

      <Text style={styles.label}>Slippage</Text>
      <View style={styles.chips}>
        {SLIPPAGE_PRESETS_BPS.map(preset => (
          <TouchableOpacity
            key={preset ?? 'auto'}
            style={[styles.chip, draftBps === preset && !isCustomDraft && styles.chipActive]}
            onPress={() => {
              setDraftBps(preset);
              setDraftCustomText('');
            }}
            activeOpacity={0.7}>
            <Text style={[styles.chipText, draftBps === preset && !isCustomDraft && styles.chipTextActive]}>{slippagePresetLabel(preset)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.customRow}>
        <TouchableOpacity
          style={[styles.chip, styles.customChip, isCustomDraft && styles.chipActive]}
          onPress={() => {
            setDraftCustomText(draftCustomText || (draftBps ? String(Number(draftBps) / 100) : ''));
          }}
          activeOpacity={0.7}>
          <Text style={[styles.chipText, isCustomDraft && styles.chipTextActive]}>Custom</Text>
        </TouchableOpacity>
        <AppTextInput
          value={draftCustomText}
          onChangeText={text => {
            setDraftCustomText(text);
            setDraftBps(bpsFromPercentInput(text));
          }}
          placeholder="0.00"
          keyboardType="decimal-pad"
          style={styles.customInput}
        />
        <Text style={styles.customPercentSign}>%</Text>
      </View>
      {draftCustomText.length > 0 && draftBps === null && <Text style={styles.errorText}>Enter a value between 0.01 and 100.</Text>}
      {draftBps !== null && Number(draftBps) > 500 && <Text style={styles.warningText}>High slippage tolerance — you may receive significantly less than quoted.</Text>}

      <Text style={styles.minReceivedLine}>Minimum received = quoted × (1 − {draftBps !== null ? `${(Number(draftBps) / 100).toString()}%` : '0%'})</Text>

      <TouchableOpacity style={styles.saveButton} onPress={handleSave} activeOpacity={0.85}>
        <Text style={styles.saveButtonText}>Save</Text>
      </TouchableOpacity>
      <Text style={styles.hint}>Closing without saving keeps {slippagePresetLabel(slippageBps)} active</Text>
    </BottomSheet>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    headerRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18},
    title: {color: colors.textPrimary, fontSize: 17, fontWeight: '800'},
    activeBadge: {backgroundColor: colors.pillBg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5},
    activeBadgeText: {color: colors.textPrimary, fontSize: 11.5, fontWeight: '700'},
    label: {color: colors.textMuted, fontSize: 11.5, fontWeight: '700', marginBottom: 8},
    chips: {flexDirection: 'row', gap: 6, marginBottom: 8},
    chip: {flex: 1, alignItems: 'center', backgroundColor: colors.pillBg, borderRadius: 12, paddingVertical: 11},
    chipActive: {backgroundColor: colors.ctaBg},
    chipText: {color: colors.textSecondary, fontSize: 13, fontWeight: '700'},
    chipTextActive: {color: colors.ctaText},
    customRow: {flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12},
    customChip: {flex: 0, paddingHorizontal: 16},
    customInput: {flex: 1, textAlign: 'right'},
    customPercentSign: {color: colors.textPrimary, fontSize: 13, fontWeight: '700'},
    errorText: {color: colors.danger, fontSize: 11.5, marginBottom: 8},
    warningText: {color: colors.danger, fontSize: 11.5, marginBottom: 8},
    minReceivedLine: {color: colors.textMuted, fontSize: 11, fontFamily: 'monospace', marginBottom: 16},
    saveButton: {backgroundColor: colors.ctaBg, borderRadius: 14, paddingVertical: 15, alignItems: 'center'},
    saveButtonText: {color: colors.ctaText, fontSize: 14.5, fontWeight: '800'},
    hint: {color: colors.textMuted, fontSize: 10.5, textAlign: 'center', marginTop: 10},
  });
}
