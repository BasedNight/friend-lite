import { useState, useRef, useCallback, useEffect } from 'react';
import { Alert } from 'react-native';
import { OmiConnection } from '@omi-fork/friend-lite-react-native';
import { Subscription, ConnectionPriority } from 'react-native-ble-plx'; // OmiConnection might use this type for subscriptions

interface UseButtonListener {
  isListeningButton: boolean;
  buttonPacketsReceived: number;
  startButtonListener: (onButtonTrigger: (bytes: Uint8Array) => void) => Promise<void>;
  stopButtonListener: () => Promise<void>;
  isRetrying: boolean;
  retryAttempts: number;
}

export const useButtonListener = (
  omiConnection: OmiConnection,
  isConnected: () => boolean // Function to check current connection status
): UseButtonListener => {
  const [isListeningButton, setIsListeningButton] = useState<boolean>(false);
  const [buttonPacketsReceived, setButtonPacketsReceived] = useState<number>(0);
  const [isRetrying, setIsRetrying] = useState<boolean>(false);
  const [retryAttempts, setRetryAttempts] = useState<number>(0);

  const buttonSubscriptionRef = useRef<Subscription | null>(null);
  const uiUpdateIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const localPacketCounterRef = useRef<number>(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const shouldRetryRef = useRef<boolean>(false);
  const currentOnButtonTriggerRef = useRef<((bytes: Uint8Array) => void) | null>(null);

  // Retry configuration
  const MAX_RETRY_ATTEMPTS = 10;
  const INITIAL_RETRY_DELAY = 1000; // 1 second
  const MAX_RETRY_DELAY = 60000; // 60 seconds

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
        // setAudioPacketsReceived(0); // Optionally reset global counter on stop, or keep cumulative
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

  // Calculate exponential backoff delay
  const getRetryDelay = useCallback((attemptNumber: number): number => {
    const delay = Math.min(INITIAL_RETRY_DELAY * Math.pow(2, attemptNumber), MAX_RETRY_DELAY);
    // Add jitter to prevent thundering herd
    const jitter = Math.random() * 0.3 * delay;
    return delay + jitter;
  }, []);

  // Internal function to attempt starting button listener
  const attemptStartButtonListener = useCallback(async (onButtonTrigger: (bytes: Uint8Array) => void): Promise<boolean> => {
    if (!isConnected()) {
      console.log('[ButtonListener] Device not connected, cannot start button listener');
      return false;
    }

    try {
      // Request high connection priority before starting button listener
      await omiConnection.requestConnectionPriority(ConnectionPriority.High);
      console.log('[ButtonListener] Requested high connection priority');
    } catch (error) {
      console.error('[ButtonListener] Failed to request high connection priority:', error);
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
        console.log('[ButtonListener] Button listener started successfully');
        return true;
      } else {
        console.error('[ButtonListener] No subscription returned from startButtonListener');
        return false;
      }
    } catch (error) {
      console.error('[ButtonListener] Failed to start button listener:', error);
      return false;
    }
  }, [omiConnection, isConnected]);

  // Retry mechanism with exponential backoff
  const retryStartButtonListener = useCallback(async () => {
    if (!shouldRetryRef.current || !currentOnButtonTriggerRef.current) {
      console.log('[ButtonListener] Retry cancelled or no callback available');
      return;
    }

    const currentAttempt = retryAttempts;
    if (currentAttempt >= MAX_RETRY_ATTEMPTS) {
      console.log(`[ButtonListener] Maximum retry attempts (${MAX_RETRY_ATTEMPTS}) reached`);
      setIsRetrying(false);
      setIsListeningButton(false);
      Alert.alert(
        'Button Listener Failed',
        `Failed to start button listener after ${MAX_RETRY_ATTEMPTS} attempts. Please try again manually.`
      );
      return;
    }

    console.log(`[ButtonListener] Retry attempt ${currentAttempt + 1}/${MAX_RETRY_ATTEMPTS}`);
    setRetryAttempts(currentAttempt + 1);
    setIsRetrying(true);

    const success = await attemptStartButtonListener(currentOnButtonTriggerRef.current);

    if (success) {
      console.log('[ButtonListener] Retry successful');
      return;
    }

    // If still should retry, schedule next attempt
    if (shouldRetryRef.current) {
      const delay = getRetryDelay(currentAttempt);
      console.log(`[ButtonListener] Scheduling retry in ${Math.round(delay)}ms`);

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
      console.log('[ButtonListener] Button listener is already active. Stopping first.');
      await stopButtonListener();
    }

    // Store the callback for retry attempts
    currentOnButtonTriggerRef.current = onButtonTrigger;
    shouldRetryRef.current = true;

    setButtonPacketsReceived(0); // Reset counter on start
    localPacketCounterRef.current = 0;
    setRetryAttempts(0);
    console.log('[ButtonListener] Starting button listener...');

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
      console.log('[ButtonListener] Initial attempt failed, starting retry mechanism');
      setIsRetrying(true);
      // Start retry mechanism
      retryStartButtonListener();
    }
  }, [omiConnection, isConnected, stopButtonListener, attemptStartButtonListener, retryStartButtonListener]);

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
    isListeningButton,
    buttonPacketsReceived,
    startButtonListener,
    stopButtonListener,
    isRetrying,
    retryAttempts,
  };
};
