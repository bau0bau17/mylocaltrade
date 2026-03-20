import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
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
      router.replace('/pricing'); // Traders usually pick a plan after signup
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
        <Text style={styles.title}>Join as a Trader</Text>
        <Text style={styles.subtitle}>Grow your business with MyLocalTrade</Text>
      </View>

      <View style={styles.form}>
        <Text style={styles.sectionTitle}>Business Details</Text>
        
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Business Name *</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Smith Plumbing Ltd"
            value={formData.businessName}
            onChangeText={(text) => setFormData(prev => ({ ...prev, businessName: text }))}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Main Category *</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Plumber, Electrician"
            value={formData.mainCategory}
            onChangeText={(text) => setFormData(prev => ({ ...prev, mainCategory: text }))}
          />
        </View>

        <View style={styles.row}>
          <View style={[styles.inputGroup, { flex: 2 }]}>
            <Text style={styles.label}>Town/City *</Text>
            <TextInput
              style={styles.input}
              placeholder="London"
              value={formData.town}
              onChangeText={(text) => setFormData(prev => ({ ...prev, town: text }))}
            />
          </View>
          <View style={[styles.inputGroup, { flex: 1, marginLeft: 12 }]}>
            <Text style={styles.label}>Postcode *</Text>
            <TextInput
              style={styles.input}
              placeholder="EC1A 1BB"
              value={formData.postcode}
              onChangeText={(text) => setFormData(prev => ({ ...prev, postcode: text }))}
              autoCapitalize="characters"
            />
          </View>
        </View>

        <Text style={[styles.sectionTitle, { marginTop: 12 }]}>Contact & Login Details</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Your Name *</Text>
          <TextInput
            style={styles.input}
            placeholder="John Smith"
            value={formData.contactName}
            onChangeText={(text) => setFormData(prev => ({ ...prev, contactName: text }))}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Email Address *</Text>
          <TextInput
            style={styles.input}
            placeholder="you@business.com"
            value={formData.email}
            onChangeText={(text) => setFormData(prev => ({ ...prev, email: text }))}
            keyboardType="email-address"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Phone Number *</Text>
          <TextInput
            style={styles.input}
            placeholder="07700 900000"
            value={formData.phone}
            onChangeText={(text) => setFormData(prev => ({ ...prev, phone: text }))}
            keyboardType="phone-pad"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Password * (Min 8 chars)</Text>
          <TextInput
            style={styles.input}
            placeholder="Create a secure password"
            value={formData.password}
            onChangeText={(text) => setFormData(prev => ({ ...prev, password: text }))}
            secureTextEntry
          />
        </View>

        <Pressable 
          style={[styles.button, isLoading && styles.buttonDisabled]} 
          onPress={handleRegister}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#FFF" />
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
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: Colors.light.textSecondary,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 8,
  },
  form: {
    gap: 16,
  },
  row: {
    flexDirection: 'row',
  },
  inputGroup: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.light.text,
  },
  input: {
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    paddingHorizontal: 16,
    height: 48,
    fontSize: 16,
    color: Colors.light.text,
  },
  button: {
    backgroundColor: Colors.light.secondary,
    height: 48,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
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
    fontWeight: '600',
  },
});