function updateDateTime() {
    const now = new Date();
    const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const timeOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit' };
  
    const currentDate = document.getElementById('currentDate');
    const currentTime = document.getElementById('currentTime');
  
    if (currentDate) currentDate.textContent = now.toLocaleDateString('en-US', dateOptions);
    if (currentTime) currentTime.textContent = now.toLocaleTimeString('en-US', timeOptions);
  }
  
  updateDateTime(); // Update on load
  setInterval(updateDateTime, 1000); // Update every second
  