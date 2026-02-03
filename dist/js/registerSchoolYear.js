let termCount = 0;
let classes = [];

async function fetchClasses() {
    try {
        const response = await axios.get('/common/getClasses');
        classes = response.data;
        // Add the first term once classes are fetched
        addTerm();
    } catch (error) {
        console.error('Error fetching classes:', error);
    }
}

function addTerm() {
    termCount++;
    if (termCount <= 4) {
        const container = document.getElementById('termsContainer');
        const classCheckboxes = classes.map(cls => `
            <div class="class-checkbox-container">
                <label>
                    <input type="checkbox" name="term${termCount}Classes[]" value="${cls.class_id}">
                    ${cls.class_name}
                </label>
            </div>
        `).join('');

        const html = `
            <fieldset>
                <legend>Term/Semester ${termCount}</legend>
                <input type="text" name="termName${termCount}" placeholder="Term/Semester ${termCount}" required>
                <div class="term-dates">
                    <div>
                        <label for="startDate${termCount}">Start Date</label>
                        <input type="date" id="startDate${termCount}" name="startDate${termCount}" placeholder="Start Date (optional)">
                    </div>
                    <div>
                        <label for="endDate${termCount}">End Date</label>
                        <input type="date" id="endDate${termCount}" name="endDate${termCount}" placeholder="End Date (optional)">
                    </div>
                </div>
                <div>
                    <label>
                        <input type="checkbox" id="selectAll${termCount}" onclick="selectAllClasses(${termCount}, this)">
                        Select All Classes
                    </label>
                </div>
                ${classCheckboxes}
            </fieldset>`;
        container.insertAdjacentHTML('beforeend', html);
    }
}

function selectAllClasses(termNumber, checkbox) {
    const checkboxes = document.querySelectorAll(`input[name="term${termNumber}Classes[]"]`);
    checkboxes.forEach(cb => cb.checked = checkbox.checked);
}

document.getElementById('registerSchoolYearForm').addEventListener('submit', function (event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const terms = [];

    for (let i = 1; i <= termCount; i++) {
        const termName = formData.get(`termName${i}`);
        const startDate = formData.get(`startDate${i}`);
        const endDate = formData.get(`endDate${i}`);
        const selectedClasses = [];
        formData.getAll(`term${i}Classes[]`).forEach(classId => {
            selectedClasses.push(parseInt(classId));
        });

        terms.push({
            termName,
            startDate,
            endDate,
            selectedClasses
        });
    }

    const payload = {
        schoolYear: formData.get('schoolYear'),
        terms: terms
    };


    fetch('/common/registerSchoolYear', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    }).then(response => response.json())
      .then(data => {
          if (data.success) {
              window.location.href = '/common/orgDashboard';
          } else {
              console.error('Failed to register school year:', data.message);
          }
      }).catch(error => console.error('Error:', error));
});

// Initially fetch classes and add the first term
fetchClasses();
