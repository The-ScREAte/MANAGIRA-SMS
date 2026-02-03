let slideIndex = 0;

// Run slideshow only if there are slides
function showSlides() {
  const slides = document.getElementsByClassName("mySlides");
  if (slides.length === 0) return;

  for (let i = 0; i < slides.length; i++) {
    slides[i].style.display = "none";  
  }
  
  slideIndex++;
  if (slideIndex > slides.length) {
    slideIndex = 1;
  }
  
  slides[slideIndex - 1].style.display = "block";  
  setTimeout(showSlides, 4000); // Change image every 4 seconds
}

showSlides();

function plusSlides(n) {
  showSlides(slideIndex += n);
}

// Keep the header solid (no blur) on scroll.
document.addEventListener('DOMContentLoaded', function () {
  const header = document.getElementById('top-header');
  if (header) header.classList.remove('blur');
});

// index page specific scripts
document.addEventListener("DOMContentLoaded", function () {
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
});
