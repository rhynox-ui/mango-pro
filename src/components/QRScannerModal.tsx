import React, {useEffect, useState} from 'react';
import {ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {Camera} from 'react-native-camera-kit';
import {PERMISSIONS, RESULTS, request} from 'react-native-permissions';

export function QRScannerModal({
  visible,
  title = 'Scan QR code',
  onClose,
  onScanned,
}: {
  visible: boolean;
  title?: string;
  onClose: () => void;
  onScanned: (value: string) => void;
}) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setReady(false);
      setError(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const permission = await request(
          // CameraKit requires an explicit runtime permission before the
          // Camera component is mounted. This keeps denied camera access
          // from producing a blank native preview.
          PERMISSIONS.ANDROID.CAMERA,
        );
        if (!cancelled) {
          if (permission === RESULTS.GRANTED) setReady(true);
          else setError('Camera permission is required to scan a QR code.');
        }
      } catch {
        if (!cancelled) setError('Could not request camera permission.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={10}>
            <Text style={styles.close}>Close</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.cameraWrap}>
          {ready ? (
            <Camera
              style={StyleSheet.absoluteFill}
              cameraType="back"
              scanBarcode
              showFrame
              onReadCode={event => {
                const value = event.nativeEvent.codeStringValue?.trim();
                if (value) onScanned(value);
              }}
            />
          ) : error ? (
            <Text style={styles.error}>{error}</Text>
          ) : (
            <ActivityIndicator size="large" />
          )}
        </View>

        <Text style={styles.hint}>Scan the recipient wallet QR code.</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#000'},
  header: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#111',
  },
  title: {color: '#fff', fontSize: 20, fontWeight: '700'},
  close: {color: '#fff', fontSize: 16},
  cameraWrap: {flex: 1, overflow: 'hidden'},
  hint: {
    color: '#fff',
    textAlign: 'center',
    paddingHorizontal: 24,
    paddingVertical: 22,
    backgroundColor: '#111',
  },
  error: {color: '#fff', textAlign: 'center', padding: 24, fontSize: 16},
});
