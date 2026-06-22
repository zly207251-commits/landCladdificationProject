#!/usr/bin/env python3
"""
Simple demo to run ProjectionAgent on a local image and inspect stored layers.

Usage:
  python run_projection_demo.py /path/to/image.jpg [task_id]

If no task_id is provided, 'demo_task_001' will be used.
"""
import sys
import os
from agent_system.memory import SharedMemory
from agent_system.messaging import MessageBus
from agent_system.projection_agent import ProjectionAgent
from land_classifier import LandSegmenterSAM


def main():
    if len(sys.argv) < 2:
        print("Usage: python run_projection_demo.py /path/to/image.jpg [task_id]")
        sys.exit(1)

    image_path = sys.argv[1]
    if not os.path.exists(image_path):
        print(f"Image not found: {image_path}")
        sys.exit(1)

    task_id = sys.argv[2] if len(sys.argv) > 2 else 'demo_task_001'

    db_path = os.path.join(os.path.dirname(__file__), '..', 'shared_memory.db')
    db_path = os.path.normpath(db_path)

    memory = SharedMemory(db_path=db_path)
    bus = MessageBus(memory)
    segmenter = LandSegmenterSAM(fail_fast=False)
    agent = ProjectionAgent(message_bus=bus, segmenter=segmenter)

    # create task if not exists
    created = memory.create_task(task_id, image_path, metadata={"pixel_scale_meters": 0.5, "line_thickness": 1})
    if created:
        print(f"Created task {task_id} with image {image_path}")
    else:
        print(f"Using existing task {task_id}")

    state = {"task_id": task_id, "image_path": image_path}
    result = agent.run(state, memory)
    print("Agent run completed. Result:", result)

    task = memory.get_task(task_id)
    print("Task record:", {k: task.get(k) for k in ['task_id','status','processed_image_path']})
    layers = memory.get_task_layers(task_id)
    print(f"Found {len(layers)} layers stored for task {task_id}:")
    for layer in layers:
        print(f" - {layer['layer_name']}: polygons={len(layer['polygons'])} area={layer['area_sq_meters']}")


if __name__ == '__main__':
    main()
