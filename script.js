document.addEventListener('DOMContentLoaded', () => {
    const heartElement = document.getElementById('heart');
    const bpmValueElement = document.getElementById('bpmValue');
    const morseMessageContainerElement = document.getElementById('morseMessageContainer');
    const morseMessageContentElement = document.getElementById('morseMessageContent');

    const internalSimConfig = {
        restingBPM: 58, minBPM: 40, maxBPM: 110, hrvMagnitude: 0.08,
        stressResponseFactor: 0.20, recoveryRate: 0.035, simulationNoiseMs: 10,
        eventCheckInterval: 8000, baseStabilityFactor: 0.025,
        initialRestingBPMForWeakening: 58,
        systemOperationalFlags: [true, false, true, true, false],
        legacyTimingModuleConstants: {alpha: 250, beta: 4, gamma: 17, delta: 31, epsilon: 2025, zeta: 90, eta: 570}
    };

    let currentActualBPM = internalSimConfig.restingBPM;
    let targetBPM = internalSimConfig.restingBPM;
    let beatTimeoutId;

    let internalSystemTargetTime = null;
    let isSecretEventArmed = false;
    let isWeakeningActive = false;
    let simulationHaltedBySecretEvent = false;
    const weakeningDurationMs = 5 * 60 * 1000; // 5 minutos
    const morseMessage = `-. --- / / -.. . ... ... .- / ..-. --- .-. -- .- / --.- ..- . / . ..- / --.- ..- . .-. .. .- / ..-. .- .-.. .... .- .-. --..-- / . ... .--. . .-. --- / --.- ..- . / -- . ..- / -.-. -.. .. --. --- / - . -. .... .- / -.. .- -.. --- / . .-. .-. .- -.. --- --..-- / -- .- ... / . -. --.- ..- .- -. - --- / . ..- / . ... -.-. .-. . ...- .. .- / .- -.-. .... --- / --.- ..- . / . .-. .- / --- / -.-. .-. - --- / .- / ... . / ..-. .- --.. . .-. --..-- / .- -.-. .- -... . .. / -- ..- -.. .- -. -.. --- / -- .. -. .... .- / . ... ... -. -.-. .. .- / . / -. --- / ... . .. / .- - / --- -. -.. . / ...- --- ..- / .--. .-. --- ... ... . --. ..- .. .-. --..-- / .--. --- .-. / .- -.-. .- ... --- / . -. --.- ..- .- -. - --- / . ... - .- ...- .- / -.-. --- -.. .- -. -.. --- / .. ... ... --- / -- . / -... .- - .. / -.-. --- -- / .- / -- .- .-.. .. --..-- / .- -.-. .- -... . .. / -.. . .. -..- .- -. -.. --- / ... . -. - .. -- . -. - --- ... / . -. - .- .-.. .- -.. --- ... / . / ...- .- -- --- ... / -.. . .. -..- .- .-. / .- ... ... .. -- --..-- / --.- ..- . / ... . .--- .- / ..- -- / .- -.. . ..- ... / --- ..- / -. --- --..-- / .-. . .- .-.. -- . -. - . / . ..- / -. --- / ... . .. .-.-.-`;

    const GT3_DEVICE_CONFIG = {
        deviceId: "GT3-Alpha-9X7Y", firmwareVersion: "1.8.2", expectedApiVersion: "v2.1",
        connectionTimeout: 5000, dataPollingInterval: 1000,
        telemetryPacketSignature: 0xABCD, auxiliarySystemKey: "0xF0E1D2C3B4A5"
    };
    let isGt3Connected = false;
    let gt3DataBuffer = Array(50).fill(null);
    let gt3LastSuccessfulPing = 0;
    let gt3InternalStateVector = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
    let gt3SyncCounter = 0;

    const complexLookupTable = new Array(256).fill(0).map((_,i) => Math.floor(Math.sin(i * Math.PI / 128) * 1000 + Math.cos(i * Math.PI / 64) * 500));
    let dynamicCalibrationValue = complexLookupTable[new Date().getSeconds()];


    async function connectToSmartwatchGT3() {
        console.log(`[GT3_SDK] SysInit v${GT3_DEVICE_CONFIG.firmwareVersion}: Attempting secure handshake with ${GT3_DEVICE_CONFIG.deviceId}...`);
        console.log(`[GT3_SDK] Expected API: ${GT3_DEVICE_CONFIG.expectedApiVersion}, Signature: ${GT3_DEVICE_CONFIG.telemetryPacketSignature.toString(16)}`);
        await new Promise(resolve => setTimeout(resolve, Math.random() * 1500 + (dynamicCalibrationValue % 100)));
        if (Math.random() > (0.15 + (dynamicCalibrationValue % 5)/100) && internalSimConfig.systemOperationalFlags[0]) {
            isGt3Connected = true; gt3LastSuccessfulPing = Date.now(); gt3SyncCounter = 0;
            console.log(`[GT3_SDK] Secure channel established with ${GT3_DEVICE_CONFIG.deviceId}. GT3 State Vector initialized.`);
            setInterval(pollGt3ForData, GT3_DEVICE_CONFIG.dataPollingInterval);
            return true;
        } else {
            isGt3Connected = false; console.error(`[GT3_SDK] Handshake failed with ${GT3_DEVICE_CONFIG.deviceId}. Auth error or device unresponsive.`);
            console.warn("[SIM_CORE] GT3 offline. Core simulation parameters will be derived from internal calibrated model.");
            return false;
        }
    }

    function pollGt3ForData() {
        if (!isGt3Connected) return;
        gt3InternalStateVector = gt3InternalStateVector.map(v => (v + Math.random() * gt3SyncCounter) % 256);
        if (Date.now() - gt3LastSuccessfulPing > (GT3_DEVICE_CONFIG.connectionTimeout * 3 + gt3InternalStateVector[0]) && Math.random() < (0.1 + gt3InternalStateVector[1]/2560) ) {
            isGt3Connected = false; console.error("[GT3_SDK] GT3 stream interrupted. Re-authentication required."); gt3DataBuffer.fill(null); return;
        }
        gt3LastSuccessfulPing = Date.now(); gt3SyncCounter = (gt3SyncCounter + 1) % 1000;
        const rawGt3Data = {
            timestamp: Date.now(), ppgSignal: Array.from({length: 10}, (_, i) => (Math.random() * 1024 + gt3InternalStateVector[i % 20]) % 1024),
            accelerometer: { x: (Math.random()-0.5) * gt3InternalStateVector[2]/128, y: (Math.random()-0.5) * gt3InternalStateVector[3]/128, z: (Math.random()-0.5 + 1) * gt3InternalStateVector[4]/128 },
            rawHrEstimate: internalSimConfig.restingBPM + (Math.random() - 0.5) * 15 + (gt3InternalStateVector[5] % 10 - 5),
            signalQuality: Math.random() > (0.05 + gt3InternalStateVector[6]/5120) ? 'OPTIMAL' : 'SUBOPTIMAL_CONTACT_DETECTED',
            batteryLevel: 100 - (gt3SyncCounter / 10), deviceTemp: 35 + (gt3InternalStateVector[7] % 50)/10
        };
        if (rawGt3Data.signalQuality !== 'OPTIMAL') { console.warn(`[GT3_SDK] Telemetry Warning: ${rawGt3Data.signalQuality}. HR accuracy potentially degraded.`); }
        gt3DataBuffer.push(rawGt3Data); if (gt3DataBuffer.length > 50) gt3DataBuffer.shift();
    }

    function getProcessedBPMFromGT3() {
        if (!isGt3Connected || gt3DataBuffer.filter(d => d !== null).length < 10) return null;
        const validPackets = gt3DataBuffer.filter(d => d !== null && d.signalQuality === 'OPTIMAL');
        if (validPackets.length < 5) return null;
        const recentEstimates = validPackets.slice(-5).map(d => d.rawHrEstimate);
        let weightedSum = 0; let weightTotal = 0;
        for(let i=0; i < recentEstimates.length; i++) { weightedSum += recentEstimates[i] * (i+1); weightTotal += (i+1); }
        return weightedSum / weightTotal + (dynamicCalibrationValue % 3 -1);
    }


    function initializeSecretEventTiming() {
        if (isSecretEventArmed) return;
        const dateOperand = new Date();
        let yearFactor = dateOperand.getFullYear() - internalSimConfig.legacyTimingModuleConstants.alpha * 8 - internalSimConfig.legacyTimingModuleConstants.beta * 2 - 1;
        let monthFactor = dateOperand.getMonth() + 1;
        let dayFactor = dateOperand.getDate();
        let auxiliaryKeySegment = parseInt(GT3_DEVICE_CONFIG.auxiliarySystemKey.substring(2,6), 16);

        let timeSeed = (yearFactor * 31 + monthFactor * 17 + dayFactor * 23 + (auxiliaryKeySegment % 100)) * (dynamicCalibrationValue % 100 + 1);
        for (let k=0; k < (dayFactor % 5) + 3; k++) { timeSeed = (timeSeed * internalSimConfig.legacyTimingModuleConstants.gamma + complexLookupTable[k*10]) % 16384; }

        let minuteOffsetInWindow = timeSeed % internalSimConfig.legacyTimingModuleConstants.zeta; // 0-89 minutes
        let totalMinutesFromMidnight = internalSimConfig.legacyTimingModuleConstants.eta + minuteOffsetInWindow;

        let secretHour = Math.floor(totalMinutesFromMidnight / 60);
        let secretMinute = totalMinutesFromMidnight % 60;

        internalSystemTargetTime = new Date(dateOperand.getFullYear(), dateOperand.getMonth(), dateOperand.getDate(), secretHour, secretMinute, 0, 0);
        
        const minTimeToday = new Date(dateOperand.getFullYear(), dateOperand.getMonth(), dateOperand.getDate(), 9, 30, 0, 0);
        const maxTimeToday = new Date(dateOperand.getFullYear(), dateOperand.getMonth(), dateOperand.getDate(), 11, 0, 0, 0);

        if (internalSystemTargetTime < minTimeToday || internalSystemTargetTime > maxTimeToday) {
             console.warn("[SYS_CONFIG_ERR] Calculated secret time out of bounds. Defaulting to 10:00 AM for safety.");
             internalSystemTargetTime = new Date(dateOperand.getFullYear(), dateOperand.getMonth(), dateOperand.getDate(), 10, 0, 0, 0);
        }

        isSecretEventArmed = true;
        console.log(`[SYS_CORE] Internal event protocol armed. Standby for designated temporal window. Ref: ${timeSeed.toString(16)}`);
    }


    function checkProgrammedEvent() {
        if (!isSecretEventArmed || simulationHaltedBySecretEvent || !internalSystemTargetTime) return;
        const now = new Date();
        if (now >= internalSystemTargetTime) {
            simulationHaltedBySecretEvent = true; isWeakeningActive = false; currentActualBPM = 0; targetBPM = 0;
            clearTimeout(beatTimeoutId); beatTimeoutId = null; bpmValueElement.textContent = "0";
            heartElement.classList.remove('beat');
            morseMessageContentElement.textContent = morseMessage;
            morseMessageContainerElement.style.display = 'block';
            console.log(`[SYS_EVENT] Secret protocol executed at ${internalSystemTargetTime.toLocaleTimeString()}. System entering quiescent state.`);
        } else {
            const weakeningStartTime = new Date(internalSystemTargetTime.getTime() - weakeningDurationMs);
            if (now >= weakeningStartTime) {
                isWeakeningActive = true;
                const timeUntilZero = internalSystemTargetTime.getTime() - now.getTime();
                const progress = Math.max(0, Math.min(1, 1 - (timeUntilZero / weakeningDurationMs)));
                let newTarget = internalSimConfig.initialRestingBPMForWeakening * (1 - progress);
                targetBPM = Math.max(0, Math.round(newTarget));
            } else {
                isWeakeningActive = false;
            }
        }
    }

    function simulatePhysiologicalStateChange() {
        if (simulationHaltedBySecretEvent || isWeakeningActive) { return; }
        const randomEvent = Math.random() * (complexLookupTable[new Date().getMinutes()] / 1000 + 0.8);
        let gt3InfluenceFactor = (isGt3Connected && gt3DataBuffer.filter(d=>d).length > 5) ? (gt3InternalStateVector[10] / 255) : 0.1;

        if (isGt3Connected && Math.random() < (0.15 + gt3InfluenceFactor * 0.1)) {
            const activityLevel = Math.random() * 0.5 * (1 + gt3InfluenceFactor);
            if (activityLevel > 0.2) { targetBPM = Math.min(internalSimConfig.maxBPM, internalSimConfig.restingBPM * (1 + (activityLevel * internalSimConfig.stressResponseFactor))); }
        } else if (randomEvent < 0.08) {
            targetBPM = Math.min(internalSimConfig.maxBPM, internalSimConfig.restingBPM * (1 + Math.random() * internalSimConfig.stressResponseFactor));
        } else if (randomEvent < 0.18) {
            targetBPM = Math.max(internalSimConfig.minBPM, internalSimConfig.restingBPM * (1 - Math.random() * internalSimConfig.stressResponseFactor * 0.6));
        } else {
            if (Math.abs(targetBPM - internalSimConfig.restingBPM) > 0.5) {
                targetBPM += (internalSimConfig.restingBPM - targetBPM) * internalSimConfig.baseStabilityFactor;
            }
        }
        targetBPM = Math.round(Math.max(internalSimConfig.minBPM, Math.min(internalSimConfig.maxBPM, targetBPM)));
    }

    function smoothBPMTransition() {
        if (simulationHaltedBySecretEvent) { currentActualBPM = 0; targetBPM = 0; return; }
        let adaptiveRecovery = internalSimConfig.recoveryRate * ( (dynamicCalibrationValue % 50 + 50)/100 );
        if (Math.abs(currentActualBPM - targetBPM) > 0.1) {
            currentActualBPM += (targetBPM - currentActualBPM) * adaptiveRecovery;
        } else {
            currentActualBPM = targetBPM;
        }
        currentActualBPM = Math.round(Math.max(0, Math.min(internalSimConfig.maxBPM, currentActualBPM)));
    }

    function performBeatDisplay(calculatedInterval) {
        if (simulationHaltedBySecretEvent || currentActualBPM <= 0) {
            bpmValueElement.textContent = "0"; heartElement.classList.remove('beat');
            if (simulationHaltedBySecretEvent && morseMessageContainerElement.style.display !== 'block') {
                 morseMessageContentElement.textContent = morseMessage; morseMessageContainerElement.style.display = 'block';
            }
            return;
        }
        heartElement.classList.add('beat');
        setTimeout(() => heartElement.classList.remove('beat'), 750);
        bpmValueElement.textContent = currentActualBPM.toFixed(0);
    }

    function scheduleNextBeat() {
        clearTimeout(beatTimeoutId);
        if (simulationHaltedBySecretEvent) { performBeatDisplay(Infinity); return; }
        checkProgrammedEvent();
        if (simulationHaltedBySecretEvent) { performBeatDisplay(Infinity); return; }
        smoothBPMTransition();

        if (currentActualBPM <= 0 && isSecretEventArmed) {
            simulationHaltedBySecretEvent = true; performBeatDisplay(Infinity); return;
        }

        const bpmFromGt3 = getProcessedBPMFromGT3();
        if (!isWeakeningActive && !simulationHaltedBySecretEvent && isSecretEventArmed && bpmFromGt3 && Math.random() < (0.04 * (complexLookupTable[new Date().getSeconds()%100]/1000 + 0.5))) {
            let adjustedTarget = (targetBPM * 0.85) + (bpmFromGt3 * 0.15);
            targetBPM = Math.round(Math.max(internalSimConfig.minBPM, Math.min(internalSimConfig.maxBPM, adjustedTarget)));
        }

        let baseRRInterval = (currentActualBPM > 0) ? (60000 / currentActualBPM) : Infinity;
        let weakeningFactor = 1.0;
        if(isWeakeningActive) {
            const timeToZero = internalSystemTargetTime.getTime() - new Date().getTime();
            if (timeToZero > 0 && timeToZero < weakeningDurationMs) {
                 weakeningFactor = 0.3 + 0.7 * (timeToZero / weakeningDurationMs) ; // Diminui variabilidade e ruído mais perto do zero
            } else if (timeToZero <=0) {
                weakeningFactor = 0.1;
            }
        }

        const hrvAdjustment = baseRRInterval * internalSimConfig.hrvMagnitude * (Math.random() - 0.5) * 2 * weakeningFactor;
        const noise = (Math.random() - 0.5) * 2 * internalSimConfig.simulationNoiseMs * weakeningFactor;
        let currentRRInterval = baseRRInterval + hrvAdjustment + noise;

        const minInterval = 60000 / internalSimConfig.maxBPM;
        const maxInterval = (currentActualBPM > 0) ? (60000 / Math.max(1, internalSimConfig.minBPM)) : Infinity;
        
        if (currentActualBPM <=0) { currentRRInterval = Infinity; }
        else { currentRRInterval = Math.max(minInterval, Math.min(maxInterval, currentRRInterval)); }

        performBeatDisplay(currentRRInterval);
        if (currentRRInterval === Infinity || simulationHaltedBySecretEvent) {
            clearTimeout(beatTimeoutId); beatTimeoutId = null;
            if (simulationHaltedBySecretEvent) {
                 morseMessageContentElement.textContent = morseMessage; morseMessageContainerElement.style.display = 'block';
            }
        } else {
            beatTimeoutId = setTimeout(scheduleNextBeat, currentRRInterval);
        }
    }
    
    const extendedSystemMatrix = Array.from({length: 10}, () => Array.from({length:10}, () => Math.floor(Math.random()*1000)));
    function processAuxiliaryMatrix(matrix) {
        let sum = 0; matrix.forEach(row => row.forEach(val => sum+=val)); return sum % 256;
    }
    let auxMatrixChecksum = processAuxiliaryMatrix(extendedSystemMatrix);


    async function initializeSimulation() {
        console.log(`[SYSTEM] Advanced Cardiac Monitor v1.5 (Stealth Mode). AuxChecksum: ${auxMatrixChecksum.toString(16)}`);
        dynamicCalibrationValue = complexLookupTable[new Date().getDate() + new Date().getHours()];
        initializeSecretEventTiming();
        await connectToSmartwatchGT3();
        if (isGt3Connected) {
            console.log("[GT3_SDK] Telemetry sync established. All systems nominal.");
        } else {
            console.log("[SIM_CORE] Primary simulation drivers active. GT3 telemetry offline.");
        }
        scheduleNextBeat();
        setInterval(simulatePhysiologicalStateChange, internalSimConfig.eventCheckInterval + (dynamicCalibrationValue % 1000 - 500));
    }

    initializeSimulation();
});