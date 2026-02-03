const enrolledSubjects = <%- JSON.stringify(enrolledSubjects) %>;

function updateSubjects(classId) {
    const subjectContainer = document.getElementById('subjectContainer');
    if (!classId) {
        subjectContainer.innerHTML = '';
        return;
    }

    fetch(`/common/getSubjectsForClass?classId=${classId}`)
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        })
        .then(data => {
            let subjectsHTML = '';
            data.forEach(subject => {
                subjectsHTML += `<div>
                                    <input type="checkbox" name="subjects[]" value="${subject.subject_id}" id="subject${subject.subject_id}" ${enrolledSubjects.includes(subject.subject_id) ? 'checked' : ''}>
                                    <label for="subject${subject.subject_id}">${subject.subject_name}</label>
                                 </div>`;
            });
            subjectContainer.innerHTML = subjectsHTML;
        })
        .catch(error => {
            console.error('Error loading subjects:', error);
            subjectContainer.innerHTML = '<div>Error loading subjects.</div>';
        });
}

function selectAll(checked) {
    document.querySelectorAll('#subjectContainer input[type="checkbox"]').forEach(checkbox => {
        checkbox.checked = checked;
    });
}

document.getElementById('classSelect').addEventListener('change', function() {
    const classId = this.value;
    const gradYearDisplay = document.getElementById('gradYearGroupDisplay');

    fetch(`/api/getGradYearGroupByClassId?classId=${classId}`)
        .then(response => response.json())
        .then(data => {
            if (data.grad_year_group_name) {
                gradYearDisplay.textContent = `Student will be a member of the ${data.grad_year_group_name}.`;
                gradYearDisplay.classList.remove('error');
                gradYearDisplay.classList.add('success');
            } else {
                gradYearDisplay.textContent = 'No graduation year group assigned to this class.';
                gradYearDisplay.classList.remove('success');
                gradYearDisplay.classList.add('error');
            }
        })
        .catch(error => {
            console.error('Error fetching graduation year group:', error);
            gradYearDisplay.textContent = 'Failed to fetch graduation year group data.';
            gradYearDisplay.classList.remove('success');
            gradYearDisplay.classList.add('error');
        });

    updateSubjects(classId);
});

// Call updateSubjects with the current class_id
updateSubjects('<%= student.class_id %>');
