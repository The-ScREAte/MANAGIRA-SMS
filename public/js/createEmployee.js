// public/scripts/createEmployee.js
const subjectsByClass = {
    class1: ['Math', 'Science', 'History'],
    class2: ['English', 'Geography', 'Biology']
};

function showSubjects(classSelected) {
    const subjectContainer = document.getElementById('subjectContainer');
    const subjectCheckboxes = document.getElementById('subjectCheckboxes');
    subjectCheckboxes.innerHTML = ''; // Clear previous subjects

    if (classSelected && subjectsByClass[classSelected]) {
        const allLabel = document.createElement('label');
        const allCheckbox = document.createElement('input');
        allCheckbox.type = 'checkbox';
        allCheckbox.name = 'subjects';
        allCheckbox.value = 'selectAll';
        allCheckbox.onclick = toggleAllCheckboxes;
        allLabel.appendChild(allCheckbox);
        allLabel.append(' Select All');
        subjectCheckboxes.appendChild(allLabel);

        const noneLabel = document.createElement('label');
        const noneCheckbox = document.createElement('input');
        noneCheckbox.type = 'checkbox';
        noneCheckbox.name = 'subjects';
        noneCheckbox.value = 'none';
        noneCheckbox.onclick = toggleNoneCheckboxes;
        noneLabel.appendChild(noneCheckbox);
        noneLabel.append(' None');
        subjectCheckboxes.appendChild(noneLabel);

        subjectsByClass[classSelected].forEach(subject => {
            const label = document.createElement('label');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.name = 'subjects';
            checkbox.value = subject.toLowerCase();
            label.appendChild(checkbox);
            label.append(' ' + subject);
            subjectCheckboxes.appendChild(label);
        });
        subjectContainer.style.display = 'block';
    } else {
        subjectContainer.style.display = 'none';
    }
}

function toggleAllCheckboxes() {
    const checkboxes = document.querySelectorAll('#subjectCheckboxes input[type="checkbox"]');
    const allSelected = document.querySelector('input[value="selectAll"]').checked;
    checkboxes.forEach(checkbox => {
        if (checkbox.value !== 'none') checkbox.checked = allSelected;
    });
    document.querySelector('input[value="none"]').checked = !allSelected;
}

function toggleNoneCheckboxes() {
    const checkboxes = document.querySelectorAll('#subjectCheckboxes input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
        checkbox.checked = false;
    });
    document.querySelector('input[value="none"]').checked = true;
}
