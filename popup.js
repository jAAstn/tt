const toggle = document.getElementById('toggle');
const textarea = document.getElementById('domains');
const saveBtn = document.getElementById('saveBtn');

// Initialer Status laden
chrome.storage.sync.get(['enabled', 'specialDomains'], (data) => {
  toggle.checked = data.enabled !== false;
  // Zeige die gespeicherten Domains an
  textarea.value = (data.specialDomains || []).join(', '); 
});

toggle.addEventListener('change', () => {
  chrome.runtime.sendMessage({ action: "toggle", value: toggle.checked }, (res) => {
    if (chrome.runtime.lastError) console.error(chrome.runtime.lastError);
  });
});

saveBtn.addEventListener('click', () => {
  const domains = textarea.value
    .split(',')
    .map(d => d.trim().toLowerCase())
    .filter(Boolean); // Leere Einträge entfernen

  // UI sperren, während gespeichert wird
  saveBtn.disabled = true;

  // Sende die aktualisierten Domains an den Service Worker
  chrome.runtime.sendMessage({ action: "updateDomains", value: domains }, (res) => {
    if (chrome.runtime.lastError) {
        console.error("Fehler beim Senden/Speichern:", chrome.runtime.lastError);
        saveBtn.innerText = "Fehler!";
        saveBtn.disabled = false;
        return;
    }
    
    // VISUELLE BESTÄTIGUNG
    const originalText = saveBtn.innerText;
    saveBtn.innerText = "Gespeichert!";
    saveBtn.classList.add('success'); // Grüne Farbe anwenden
    
    // Lese die Daten sofort nach dem Speichern erneut, um die Anzeige zu bestätigen
    chrome.storage.sync.get(['specialDomains'], (data) => {
        textarea.value = (data.specialDomains || []).join(', ');
        
        // Button nach kurzer Verzögerung wieder in den Normalzustand versetzen
        setTimeout(() => {
            saveBtn.innerText = originalText;
            saveBtn.classList.remove('success');
            saveBtn.disabled = false;
        }, 1500);
    });
  });
});