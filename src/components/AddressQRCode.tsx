import React from 'react';
import {StyleSheet, View} from 'react-native';
import QRCode from 'react-native-qrcode-svg';

export function AddressQRCode({value, size = 220}: {value: string; size?: number}) {
  return (
    <View style={styles.wrap}>
      <QRCode value={value} size={size} backgroundColor="#ffffff" color="#000000" ecl="H" quietZone={8} />
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
