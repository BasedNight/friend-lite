import { useState, useRef, useCallback, useEffect } from 'react';
import { Alert } from 'react-native';
import { OmiConnection } from '@omi-fork/friend-lite-react-native';
import { Subscription, ConnectionPriority } from 'react-native-ble-plx'; // OmiConnection might use this type for subscriptions

interface UseOmiListener {
  isRetrying: boolean;
  retryAttempts: number;

  audioPacketsReceived: number;
  isListeningAudio: boolean;
  startAudioListener: (onAudioData: (bytes: Uint8Array) => void) => Promise<void>;
  stopAudioListener: () => Promise<void>;

  buttonPacketsReceived: number;
  isListeningButton: boolean;
  startButtonListener: (onButtonTrigger: (bytes: Uint8Array) => void) => Promise<void>;
  stopButtonListener: () => Promise<void>;

  batteryPacketsReceived: number;
  isListeningBattery: boolean;
  startBatteryListener: (onBatteryLevel: (bytes: Uint8Array) => void) => Promise<void>;
  stopBatteryListener: () => Promise<void>;
}

export const useOmiListener = (
  omiConnection: OmiConnection,
  isConnected: () => boolean // Function to check current connection status
): UseOmiListener => {
  const [isRetrying, setIsRetrying] = useState<boolean>(false);
  const [retryAttempts, setRetryAttempts] = useState<number>(0);

  const uiUpdateIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const localPacketCounterRef = useRef<number>(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const shouldRetryRef = useRef<boolean>(false);

  const [audioPacketsReceived, setAudioPacketsReceived] = useState<number>(0);
  const [isListeningAudio, setIsListeningAudio] = useState<boolean>(false);
  const audioSubscriptionRef = useRef<Subscription | null>(null);
  const currentOnAudioDataRef = useRef<((bytes: Uint8Array) => void) | null>(null);

  const [buttonPacketsReceived, setButtonPacketsReceived] = useState<number>(0);
  const [isListeningButton, setIsListeningButton] = useState<boolean>(false);
  const buttonSubscriptionRef = useRef<Subscription | null>(null);
  const currentOnButtonTriggerRef = useRef<((bytes: Uint8Array) => void) | null>(null);

  const [batteryPacketsReceived, batteryAudioPacketsReceived] = useState<number>(0);
  const [isListeningBattery, setIsListeningBattery] = useState<boolean>(false);
  const batterySubscriptionRef = useRef<Subscription | null>(null);
  const currentOnBatteryLevelRef = useRef<((bytes: Uint8Array) => void) | null>(null);


  // Retry configuration
  const MAX_RETRY_ATTEMPTS = 10;
  const INITIAL_RETRY_DELAY = 1000; // 1 second
  const MAX_RETRY_DELAY = 60000; // 60 seconds


  const stopAudioListener = useCallback(async () => {
    console.log('Attempting to stop audio listener...');

    // Stop retry mechanism
    shouldRetryRef.current = false;
    setIsRetrying(false);
    setRetryAttempts(0);
    currentOnAudioDataRef.current = null;

    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }

    if (uiUpdateIntervalRef.current) {
      clearInterval(uiUpdateIntervalRef.current);
      uiUpdateIntervalRef.current = null;
    }

    if (audioSubscriptionRef.current) {
      try {
        await omiConnection.stopAudioListener(audioSubscriptionRef.current);
        audioSubscriptionRef.current = null;
        setIsListeningAudio(false);
        localPacketCounterRef.current = 0; // Reset local counter
        setAudioPacketsReceived(0); // Optionally reset global counter on stop, or keep cumulative
        console.log('Audio listener stopped.');
      } catch (error) {
        console.error('Stop audio listener error:', error);
        Alert.alert('Error', `Failed to stop audio listener: ${error}`);
      }
    } else {
      console.log('Audio listener was not active.');
    }
    setIsListeningAudio(false); // Ensure state is false even if no subscription was found
  }, [omiConnection]);

  const stopButtonListener = useCallback(async () => {
    console.log('Attempting to stop button listener...');

    // Stop retry mechanism
    shouldRetryRef.current = false;
    setIsRetrying(false);
    setRetryAttempts(0);
    currentOnButtonTriggerRef.current = null;

    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }

    if (uiUpdateIntervalRef.current) {
      clearInterval(uiUpdateIntervalRef.current);
      uiUpdateIntervalRef.current = null;
    }

    if (buttonSubscriptionRef.current) {
      try {
        await omiConnection.stopButtonListener(buttonSubscriptionRef.current);
        buttonSubscriptionRef.current = null;
        setIsListeningButton(false);
        localPacketCounterRef.current = 0; // Reset local counter
        setButtonPacketsReceived(0); // Optionally reset global counter on stop, or keep cumulative
        console.log('Button listener stopped.');
      } catch (error) {
        console.error('Stop button listener error:', error);
        Alert.alert('Error', `Failed to stop button listener: ${error}`);
      }
    } else {
      console.log('Button listener was not active.');
    }
    setIsListeningButton(false); // Ensure state is false even if no subscription was found
  }, [omiConnection]);

  const stopBatteryListener = useCallback(async () => {
    console.log('Attempting to stop battery listener...');

    // Stop retry mechanism
    shouldRetryRef.current = false;
    setIsRetrying(false);
    setRetryAttempts(0);
    currentOnBatteryLevelRef.current = null;

    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }

    if (uiUpdateIntervalRef.current) {
      clearInterval(uiUpdateIntervalRef.current);
      uiUpdateIntervalRef.current = null;
    }

    if (batterySubscriptionRef.current) {
      try {
        await omiConnection.stopBatteryListener(batterySubscriptionRef.current);
        batterySubscriptionRef.current = null;
        setIsListeningBattery(false);
        localPacketCounterRef.current = 0; // Reset local counter
        setBatteryPacketsReceived(0); // Optionally reset global counter on stop, or keep cumulative
        console.log('Battery listener stopped.');
      } catch (error) {
        console.error('Stop battery listener error:', error);
        Alert.alert('Error', `Failed to stop battery listener: ${error}`);
      }
    } else {
      console.log('Battery listener was not active.');
    }
    setIsListeningBattery(false); // Ensure state is false even if no subscription was found
  }, [omiConnection]);

  // Calculate exponential backoff delay
  const getRetryDelay = useCallback((attemptNumber: number): number => {
    const delay = Math.min(INITIAL_RETRY_DELAY * Math.pow(2, attemptNumber), MAX_RETRY_DELAY);
    // Add jitter to prevent thundering herd
    const jitter = Math.random() * 0.3 * delay;
    return delay + jitter;
  }, []);

  // Internal function to attempt starting audio listener
  const attemptStartAudioListener = useCallback(async (onAudioData: (bytes: Uint8Array) => void): Promise<boolean> => {
    if (!isConnected()) {
      console.log('[OmiListener] Device not connected, cannot start audio listener');
      return false;
    }

    try {
      // Request high connection priority before starting audio listener
      await omiConnection.requestConnectionPriority(ConnectionPriority.High);
      console.log('[OmiListener] Requested high connection priority');
    } catch (error) {
      console.error('[OmiListener] Failed to request high connection priority:', error);
      // Continue anyway, this is not a fatal error
    }

    try {
      const subscription = await omiConnection.startAudioListener((bytes) => {
        localPacketCounterRef.current++;
        if (bytes && bytes.length > 0) {
          onAudioData(new Uint8Array(bytes));
        }
      });

      if (subscription) {
        audioSubscriptionRef.current = subscription;
        setIsListeningAudio(true);
        setIsRetrying(false);
        setRetryAttempts(0);
        console.log('[OmiListener] Audio listener started successfully');
        return true;
      } else {
        console.error('[OmiListener] No subscription returned from startAudioListener');
        return false;
      }
    } catch (error) {
      console.error('[OmiListener] Failed to start audio listener:', error);
      return false;
    }
  }, [omiConnection, isConnected]);

  // Retry mechanism with exponential backoff
  const retryStartAudioListener = useCallback(async () => {
    if (!shouldRetryRef.current || !currentOnAudioDataRef.current) {
      console.log('[OmiListener] Retry cancelled or no callback available');
      return;
    }

    const currentAttempt = retryAttempts;
    if (currentAttempt >= MAX_RETRY_ATTEMPTS) {
      console.log(`[OmiListener] Maximum retry attempts (${MAX_RETRY_ATTEMPTS}) reached`);
      setIsRetrying(false);
      setIsListeningAudio(false);
      Alert.alert(
        'Audio Listener Failed',
        `Failed to start audio listener after ${MAX_RETRY_ATTEMPTS} attempts. Please try again manually.`
      );
      return;
    }

    console.log(`[OmiListener] Retry attempt ${currentAttempt + 1}/${MAX_RETRY_ATTEMPTS}`);
    setRetryAttempts(currentAttempt + 1);
    setIsRetrying(true);

    const success = await attemptStartAudioListener(currentOnAudioDataRef.current);

    if (success) {
      console.log('[OmiListener] Retry successful');
      return;
    }

    // If still should retry, schedule next attempt
    if (shouldRetryRef.current) {
      const delay = getRetryDelay(currentAttempt);
      console.log(`[OmiListener] Scheduling retry in ${Math.round(delay)}ms`);

      retryTimeoutRef.current = setTimeout(() => {
        if (shouldRetryRef.current) {
          retryStartAudioListener();
        }
      }, delay);
    }
  }, [retryAttempts, attemptStartAudioListener, getRetryDelay]);

  const startAudioListener = useCallback(async (onAudioData: (bytes: Uint8Array) => void) => {
    if (!isConnected()) {
      Alert.alert('Not Connected', 'Please connect to a device first to start audio listener.');
      return;
    }

    if (isListeningAudio) {
      console.log('[OmiListener] Audio listener is already active. Stopping first.');
      await stopAudioListener();
    }

    // Store the callback for retry attempts
    currentOnAudioDataRef.current = onAudioData;
    shouldRetryRef.current = true;

    setAudioPacketsReceived(0); // Reset counter on start
    localPacketCounterRef.current = 0;
    setRetryAttempts(0);
    console.log('[OmiListener] Starting audio listener...');

    // Batch UI updates for packet counter
    if (uiUpdateIntervalRef.current) clearInterval(uiUpdateIntervalRef.current);
    uiUpdateIntervalRef.current = setInterval(() => {
      if (localPacketCounterRef.current > 0) {
        setAudioPacketsReceived(prev => prev + localPacketCounterRef.current);
        localPacketCounterRef.current = 0;
      }
    }, 500); // Update UI every 500ms

    // Try to start audio listener
    const success = await attemptStartAudioListener(onAudioData);

    if (!success && shouldRetryRef.current) {
      console.log('[OmiListener] Initial attempt failed, starting retry mechanism');
      setIsRetrying(true);
      // Start retry mechanism
      retryStartAudioListener();
    }
  }, [omiConnection, isConnected, stopAudioListener, attemptStartAudioListener, retryStartAudioListener]);

  // Internal function to attempt starting button listener
  const attemptStartButtonListener = useCallback(async (onButtonTrigger: (bytes: Uint8Array) => void): Promise<boolean> => {
    if (!isConnected()) {
      console.log('[OmiListener] Device not connected, cannot start button listener');
      return false;
    }

    try {
      // Request high connection priority before starting button listener
      await omiConnection.requestConnectionPriority(ConnectionPriority.High);
      console.log('[OmiListener] Requested high connection priority');
    } catch (error) {
      console.error('[OmiListener] Failed to request high connection priority:', error);
      // Continue anyway, this is not a fatal error
    }

    try {
      const subscription = await omiConnection.startButtonListener((bytes) => {
        localPacketCounterRef.current++;
        if (bytes && bytes.length > 0) {
          onButtonTrigger(new Uint8Array(bytes));
        }
      });

      if (subscription) {
        buttonSubscriptionRef.current = subscription;
        setIsListeningButton(true);
        setIsRetrying(false);
        setRetryAttempts(0);
        console.log('[OmiListener] Button listener started successfully');
        return true;
      } else {
        console.error('[OmiListener] No subscription returned from startButtonListener');
        return false;
      }
    } catch (error) {
      console.error('[OmiListener] Failed to start button listener:', error);
      return false;
    }
  }, [omiConnection, isConnected]);

  // Retry mechanism with exponential backoff
  const retryStartButtonListener = useCallback(async () => {
    if (!shouldRetryRef.current || !currentOnButtonTriggerRef.current) {
      console.log('[OmiListener] Retry cancelled or no callback available');
      return;
    }

    const currentAttempt = retryAttempts;
    if (currentAttempt >= MAX_RETRY_ATTEMPTS) {
      console.log(`[OmiListener] Maximum retry attempts (${MAX_RETRY_ATTEMPTS}) reached`);
      setIsRetrying(false);
      setIsListeningButton(false);
      Alert.alert(
        'Button Listener Failed',
        `Failed to start button listener after ${MAX_RETRY_ATTEMPTS} attempts. Please try again manually.`
      );
      return;
    }

    console.log(`[OmiListener] Retry attempt ${currentAttempt + 1}/${MAX_RETRY_ATTEMPTS}`);
    setRetryAttempts(currentAttempt + 1);
    setIsRetrying(true);

    const success = await attemptStartButtonListener(currentOnButtonTriggerRef.current);

    if (success) {
      console.log('[OmiListener] Retry successful');
      return;
    }

    // If still should retry, schedule next attempt
    if (shouldRetryRef.current) {
      const delay = getRetryDelay(currentAttempt);
      console.log(`[OmiListener] Scheduling retry in ${Math.round(delay)}ms`);

      retryTimeoutRef.current = setTimeout(() => {
        if (shouldRetryRef.current) {
          retryStartButtonListener();
        }
      }, delay);
    }
  }, [retryAttempts, attemptStartButtonListener, getRetryDelay]);

  const startButtonListener = useCallback(async (onButtonTrigger: (bytes: Uint8Array) => void) => {
    if (!isConnected()) {
      Alert.alert('Not Connected', 'Please connect to a device first to start button listener.');
      return;
    }

    if (isListeningButton) {
      console.log('[OmiListener] Button listener is already active. Stopping first.');
      await stopButtonListener();
    }

    // Store the callback for retry attempts
    currentOnButtonTriggerRef.current = onButtonTrigger;
    shouldRetryRef.current = true;

    setButtonPacketsReceived(0); // Reset counter on start
    localPacketCounterRef.current = 0;
    setRetryAttempts(0);
    console.log('[OmiListener] Starting button listener...');

    // Batch UI updates for packet counter
    if (uiUpdateIntervalRef.current) clearInterval(uiUpdateIntervalRef.current);
    uiUpdateIntervalRef.current = setInterval(() => {
      if (localPacketCounterRef.current > 0) {
        setButtonPacketsReceived(prev => prev + localPacketCounterRef.current);
        localPacketCounterRef.current = 0;
      }
    }, 500); // Update UI every 500ms

    // Try to start button listener
    const success = await attemptStartButtonListener(onButtonTrigger);

    if (!success && shouldRetryRef.current) {
      console.log('[OmiListener] Initial attempt failed, starting retry mechanism');
      setIsRetrying(true);
      // Start retry mechanism
      retryStartButtonListener();
    }
  }, [omiConnection, isConnected, stopButtonListener, attemptStartButtonListener, retryStartButtonListener]);

  // Internal function to attempt starting battery listener
  const attemptStartBatteryListener = useCallback(async (onBatteryLevel: (bytes: Uint8Array) => void): Promise<boolean> => {
    if (!isConnected()) {
      console.log('[OmiListener] Device not connected, cannot start battery listener');
      return false;
    }

    try {
      // Request high connection priority before starting button listener
      await omiConnection.requestConnectionPriority(ConnectionPriority.High);
      console.log('[OmiListener] Requested high connection priority');
    } catch (error) {
      console.error('[OmiListener] Failed to request high connection priority:', error);
      // Continue anyway, this is not a fatal error
    }

    try {
      const subscription = await omiConnection.startBatteryListener((bytes) => {
        localPacketCounterRef.current++;
        if (bytes && bytes.length > 0) {
          onBatteryLevel(new Uint8Array(bytes));
        }
      });

      if (subscription) {
        batterySubscriptionRef.current = subscription;
        setIsListeningBattery(true);
        setIsRetrying(false);
        setRetryAttempts(0);
        console.log('[OmiListener] Battery listener started successfully');
        return true;
      } else {
        console.error('[OmiListener] No subscription returned from startBatteryListener');
        return false;
      }
    } catch (error) {
      console.error('[OmiListener] Failed to start battery listener:', error);
      return false;
    }
  }, [omiConnection, isConnected]);

  // Retry mechanism with exponential backoff
  const retryStartBatteryListener = useCallback(async () => {
    if (!shouldRetryRef.current || !currentOnBatteryLevelRef.current) {
      console.log('[OmiListener] Retry cancelled or no callback available');
      return;
    }

    const currentAttempt = retryAttempts;
    if (currentAttempt >= MAX_RETRY_ATTEMPTS) {
      console.log(`[OmiListener] Maximum retry attempts (${MAX_RETRY_ATTEMPTS}) reached`);
      setIsRetrying(false);
      setIsListeningBattery(false);
      Alert.alert(
        'Battery Listener Failed',
        `Failed to start battery listener after ${MAX_RETRY_ATTEMPTS} attempts. Please try again manually.`
      );
      return;
    }

    console.log(`[OmiListener] Retry attempt ${currentAttempt + 1}/${MAX_RETRY_ATTEMPTS}`);
    setRetryAttempts(currentAttempt + 1);
    setIsRetrying(true);

    const success = await attemptStartBatteryListener(currentOnBatteryLevelRef.current);

    if (success) {
      console.log('[OmiListener] Retry successful');
      return;
    }

    // If still should retry, schedule next attempt
    if (shouldRetryRef.current) {
      const delay = getRetryDelay(currentAttempt);
      console.log(`[OmiListener] Scheduling retry in ${Math.round(delay)}ms`);

      retryTimeoutRef.current = setTimeout(() => {
        if (shouldRetryRef.current) {
          retryStartBatteryListener();
        }
      }, delay);
    }
  }, [retryAttempts, attemptStartBatteryListener, getRetryDelay]);

  const startBatteryListener = useCallback(async (onBatteryLevel: (bytes: Uint8Array) => void) => {
    if (!isConnected()) {
      Alert.alert('Not Connected', 'Please connect to a device first to start battery listener.');
      return;
    }

    if (isListeningBattery) {
      console.log('[OmiListener] Battery listener is already active. Stopping first.');
      await stopBatteryListener();
    }

    // Store the callback for retry attempts
    currentOnBatteryLevelRef.current = onBatteryLevel;
    shouldRetryRef.current = true;

    setBatteryPacketsReceived(0); // Reset counter on start
    localPacketCounterRef.current = 0;
    setRetryAttempts(0);
    console.log('[OmiListener] Starting battery listener...');

    // Batch UI updates for packet counter
    if (uiUpdateIntervalRef.current) clearInterval(uiUpdateIntervalRef.current);
    uiUpdateIntervalRef.current = setInterval(() => {
      if (localPacketCounterRef.current > 0) {
        setBatteryPacketsReceived(prev => prev + localPacketCounterRef.current);
        localPacketCounterRef.current = 0;
      }
    }, 500); // Update UI every 500ms

    // Try to start battery listener
    const success = await attemptStartBatteryListener(onBatteryLevel);

    if (!success && shouldRetryRef.current) {
      console.log('[OmiListener] Initial attempt failed, starting retry mechanism');
      setIsRetrying(true);
      // Start retry mechanism
      retryStartBatteryListener();
    }
  }, [omiConnection, isConnected, stopBatteryListener, attemptStartBatteryListener, retryStartBatteryListener]);


  // Cleanup on unmount
  useEffect(() => {
    return () => {
      shouldRetryRef.current = false;
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
      if (uiUpdateIntervalRef.current) {
        clearInterval(uiUpdateIntervalRef.current);
      }
    };
  }, []);

  return {
    isRetrying,
    retryAttempts,

    audioPacketsReceived,
    isListeningAudio,
    startAudioListener,
    stopAudioListener,

    buttonPacketsReceived,
    isListeningButton,
    startButtonListener,
    stopButtonListener,

    batteryPacketsReceived,
    isListeningBattery,
    startBatteryListener,
    stopBatteryListener,
  };
};
