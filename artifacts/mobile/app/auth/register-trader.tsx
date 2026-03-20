import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useAuth } from '@/contexts/AuthContext';

export default function RegisterTraderScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { registerTrader } = useAuth();
  
  const [formData, setFormData] = useState({
    businessName: '',
    contactName: '',
    email: '',
    password: '',
    phone: '',
    mainCategory: '',
    town: '',
    postcode: '',
  });
  const [isLoading, setIsLoading] = useState(false);

  const handleRegister = async () => {
    const requiredFields: (keyof typeof formData)[] = ['businessName', 'contactName', 'email', 'password', 'phone', 'mainCategory', 'town', 'postcode'];
    const isMissing = requiredFields.some(field => !formData[field]);
    
    if (isMissing) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    if (formData.password.length < 8) {
      Alert.alert('Error', 'Password must be at least 8 characters');
      return;
    }
    
    setIsLoading(true);
    try {
      await registerTrader(formData);
      router.replace('/pricing');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Could not create account';
      Alert.alert('Registration Failed', message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAwareScrollViewCompat
      style={styles.container}
      contentContainerStyle={{
        paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + 24,
        paddingHorizontal: 24,
      }}
      bottomOffset={60}
    >
      <View style={styles.header}>
        <View style={styles.logoWrap}>
          <Feather name="briefcase" size={28} color={Colors.light.secondary} />
        </View>
        <Text style={styles.title}>Join as a Trader</Text>
        <Text style={styles.subtitle}>Grow your business with MyLocalTrade</Text>
      </View>

      <View style={styles.form}>
        <Text style={styles.sectionTitle}>Business Details</Text>
        
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Business Name *</Text>
          <View style={styles.inputWrap}>
            <Feather name="briefcase" size={16} color={Colors.light.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="e.g. Smith Plumbing Ltd"
              placeholderTextColor={Colors.light.textMuted}
              value={formData.businessName}
              onChangeText={(text) => setFormData(prev => ({ ...prev, businessName: text }))}
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Main Category *</Text>
          <View style={styles.inputWrap}>
            <Feather name="tag" size={16} color={Colors.light.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="e.g. Plumber, Electrician"
              placeholderTextColor={Colors.light.textMuted}
              value={formData.mainCategory}
              onChangeText={(text) => setFormData(prev => ({ ...prev, mainCategory: text }))}
            />
          </View>
        </View>

        <View style={styles.row}>
          <View style={[styles.inputGroup, { flex: 2 }]}>
            <Text style={styles.label}>Town/City *</Text>
            <View style={styles.inputWrap}>
              <Feather name="map-pin" size={16} color={Colors.light.textMuted} />
              <TextInput
                style={styles.input}
                placeholder="London"
                placeholderTextColor={Colors.light.textMuted}
                value={formData.town}
                onChangeText={(text) => setFormData(prev => ({ ...prev, town: text }))}
              />
            </View>
          </View>
          <View style={[styles.inputGroup, { flex: 1, marginLeft: 10 }]}>
            <Text style={styles.label}>Postcode *</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={[styles.input, { marginLeft: 0 }]}
                placeholder="EC1A 1BB"
                placeholderTextColor={Colors.light.textMuted}
                value={formData.postcode}
                onChangeText={(text) => setFormData(prev => ({ ...prev, postcode: text }))}
                autoCapitalize="characters"
              />
            </View>
          </View>
        </View>

        <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Contact & Login</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Your Name *</Text>
          <View style={styles.inputWrap}>
            <Feather name="user" size={16} color={Colors.light.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="John Smith"
              placeholderTextColor={Colors.light.textMuted}
              value={formData.contactName}
              onChangeText={(text) => setFormData(prev => ({ ...prev, contactName: text }))}
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Email Address *</Text>
          <View style={styles.inputWrap}>
            <Feather name="mail" size={16} color={Colors.light.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="you@business.com"
              placeholderTextColor={Colors.light.textMuted}
              value={formData.email}
              onChangeText={(text) => setFormData(prev => ({ ...prev, email: text }))}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Phone Number *</Text>
          <View style={styles.inputWrap}>
            <Feather name="phone" size={16} color={Colors.light.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="07700 900000"
              placeholderTextColor={Colors.light.textMuted}
              value={formData.phone}
              onChangeText={(text) => setFormData(prev => ({ ...prev, phone: text }))}
              keyboardType="phone-pad"
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Password * (Min 8 chars)</Text>
          <View style={styles.inputWrap}>
            <Feather name="lock" size={16} color={Colors.light.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="Create a secure password"
              placeholderTextColor={Colors.light.textMuted}
              value={formData.password}
              onChangeText={(text) => setFormData(prev => ({ ...prev, password: text }))}
              secureTextEntry
            />
          </View>
        </View>

        <Pressable 
          style={[styles.button, isLoading && styles.buttonDisabled]} 
          onPress={handleRegister}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color={Colors.light.white} />
          ) : (
            <Text style={styles.buttonText}>Register Business</Text>
          )}
        </Pressable>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Already have an account? </Text>
          <Pressable onPress={() => router.push('/auth/login')}>
            <Text style={styles.footerLink}>Log In</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  header: {
    alignItems: 'center',
    marginBottom: 28,
  },
  logoWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: Colors.light.secondaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.light.textSecondary,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.light.textMuted,
    marginBottom: 4,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  form: {
    gap: 14,
  },
  row: {
    flexDirection: 'row',
  },
  inputGroup: {
    gap: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.light.textMuted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginLeft: 4,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 50,
    gap: 10,
  },
  input: {
    flex: 1,
    height: '100%',
    fontSize: 15,
    color: Colors.light.text,
  },
  button: {
    backgroundColor: Colors.light.secondary,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: Colors.light.white,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 16,
  },
  footerText: {
    color: Colors.light.textSecondary,
    fontSize: 14,
  },
  footerLink: {
    color: Colors.light.primary,
    fontSize: 14,
    fontWeight: '700',
  },
});
