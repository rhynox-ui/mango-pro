import React from 'react';
import {StyleSheet, View} from 'react-native';
import {QRCode} from '@ttsalpha/qrcode/native';

export function AddressQRCode({value, size = 220}: {value: string; size?: number}) {
  return (
    <View style={styles.wrap}>
      <QRCode value={value} size={size} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 18,
    alignSelf: 'center',
  },
});
