// Common scripts
function toggleEditMode() {
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    const editButton = document.querySelector('.edit-button');
    const saveLinks = document.querySelectorAll('.save-link');
    const isEditable = checkboxes[0].disabled;

    checkboxes.forEach(checkbox => {
        checkbox.disabled = !isEditable;
    });

    if (isEditable) {
        editButton.textContent = 'Save Changes';
        saveLinks.forEach(link => link.style.display = 'inline');
    } else {
        editButton.textContent = 'Edit';
        saveLinks.forEach(link => link.style.display = 'none');
    }
}

// Show/Hide Password
document.addEventListener('DOMContentLoaded', function () {
    const showPasswordCheckbox = document.getElementById('show-password');
    if (showPasswordCheckbox) {
        showPasswordCheckbox.addEventListener('change', function () {
            const passwordInput = document.getElementById('password');
            const confirmPasswordInput = document.getElementById('confirmPassword');
            const type = this.checked ? 'text' : 'password';
            passwordInput.type = type;
            if (confirmPasswordInput) {
                confirmPasswordInput.type = type;
            }
        });
    }
});

function checkPasswordStrength(password) {
    const strengthElement = document.getElementById("password-strength");

    // Define regex patterns for password strength
    const regexWeak = /(?=.*[a-z])/; // At least one lowercase letter
    const regexMedium = /(?=.*[a-z])(?=.*[A-Z])/; // Lowercase and uppercase
    const regexStrong = /(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*])/; // Strong conditions

    // Determine the strength
    if (regexStrong.test(password)) {
        strengthElement.textContent = "Strong password";
        strengthElement.className = "password-strength strong";
    } else if (regexMedium.test(password)) {
        strengthElement.textContent = "Medium password";
        strengthElement.className = "password-strength medium";
    } else if (regexWeak.test(password)) {
        strengthElement.textContent = "Weak password";
        strengthElement.className = "password-strength weak";
    } else {
        strengthElement.textContent = "";
        strengthElement.className = "password-strength";
    }
}
