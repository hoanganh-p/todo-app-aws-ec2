# ─── CloudWatch ─────────────────────────────────────────────────────────────────
# CloudWatch Log Groups
resource "aws_cloudwatch_log_group" "user_data" {
  name              = "/aws/ec2/todo-app/user-data"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "docker_compose" {
  name              = "/aws/ec2/todo-app/docker-compose"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "nginx_access" {
  name              = "/aws/ec2/todo-app/nginx-access"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "nginx_error" {
  name              = "/aws/ec2/todo-app/nginx-error"
  retention_in_days = 30
}

# CloudWatch Dashboard
resource "aws_cloudwatch_dashboard" "todo_app" {
  dashboard_name = "TodoApp-EC2"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          metrics = [
            ["TodoApp/EC2", "cpu_usage_idle", "InstanceId", "${aws_instance.main.id}"],
            [".", "cpu_usage_user", ".", "."],
            [".", "cpu_usage_system", ".", "."]
          ]
          view                = "timeSeries"
          stacked             = false
          region              = "us-east-1"
          title               = "CPU Utilization"
          period              = 60
          stat                = "Average"
          yAxis = {
            left = {
              min = 0
              max = 100
            }
          }
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          metrics = [
            ["TodoApp/EC2", "mem_used_percent", "InstanceId", "${aws_instance.main.id}"]
          ]
          view                = "timeSeries"
          stacked             = false
          region              = "us-east-1"
          title               = "Memory Utilization"
          period              = 60
          stat                = "Average"
          yAxis = {
            left = {
              min = 0
              max = 100
            }
          }
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          metrics = [
            ["TodoApp/EC2", "used_percent", "InstanceId", "${aws_instance.main.id}", "path", "/"]
          ]
          view                = "timeSeries"
          stacked             = false
          region              = "us-east-1"
          title               = "Disk Usage"
          period              = 60
          stat                = "Average"
          yAxis = {
            left = {
              min = 0
              max = 100
            }
          }
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 6
        width  = 12
        height = 6
        properties = {
          metrics = [
            ["TodoApp/EC2", "read_bytes", "InstanceId", "${aws_instance.main.id}"],
            [".", "write_bytes", ".", "."]
          ]
          view                = "timeSeries"
          stacked             = false
          region              = "us-east-1"
          title               = "Disk I/O"
          period              = 60
          stat                = "Average"
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 12
        width  = 24
        height = 6
        properties = {
          metrics = [
            ["TodoApp/EC2", "tcp_established", "InstanceId", "${aws_instance.main.id}"],
            [".", "tcp_time_wait", ".", "."]
          ]
          view                = "timeSeries"
          stacked             = false
          region              = "us-east-1"
          title               = "Network Connections"
          period              = 60
          stat                = "Average"
        }
      }
    ]
  })
}